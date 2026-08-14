import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where image bytes live.
 *
 * Split out from the image store because the records belong in Postgres and
 * the bytes do not: on one machine the disk is fine, but the moment a second
 * API instance exists, an image uploaded to one is a 404 on the other. Both
 * adapters below satisfy this, and choosing between them is a deploy decision
 * rather than a code change.
 *
 * Keys look like `tenant/imageId/original` or `tenant/imageId/640.webp` — a
 * path on disk, an object key in S3.
 */
export interface BlobStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/** Bytes on the local filesystem. Fine for one instance; nothing beyond that. */
export class DiskBlobStorage implements BlobStorage {
  constructor(private readonly rootDir: string) {}

  private pathFor(key: string): string {
    return join(this.rootDir, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }
}

/**
 * Bytes in an S3-compatible bucket.
 *
 * Signs requests itself rather than pulling in the AWS SDK: this uses two of
 * the hundreds of calls S3 offers, and SigV4 over fetch is less code than the
 * dependency would add. Works with anything speaking the S3 API — Cloudflare
 * R2, Backblaze B2, MinIO, S3 itself.
 */
export class S3BlobStorage implements BlobStorage {
  constructor(
    private readonly config: {
      readonly endpoint: string;
      readonly bucket: string;
      readonly region: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
    },
  ) {}

  /**
   * Reads the configuration, or null when it is absent.
   *
   * Null rather than a throw: running on one machine with no bucket is a valid
   * setup, and the composition root decides what that means.
   */
  static fromEnvironment(): S3BlobStorage | null {
    const endpoint = process.env['S3_ENDPOINT'] ?? '';
    const bucket = process.env['S3_BUCKET'] ?? '';
    const accessKeyId = process.env['S3_ACCESS_KEY_ID'] ?? '';
    const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'] ?? '';

    if (endpoint === '' || bucket === '' || accessKeyId === '' || secretAccessKey === '') {
      return null;
    }

    return new S3BlobStorage({
      endpoint: endpoint.replace(/\/+$/, ''),
      bucket,
      region: process.env['S3_REGION'] ?? 'auto',
      accessKeyId,
      secretAccessKey,
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    const response = await this.signedFetch('PUT', key, data);
    if (!response.ok) {
      throw new Error(`s3 put ${key} respondió ${response.status}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.signedFetch('GET', key);
    if (!response.ok) {
      throw new Error(`s3 get ${key} respondió ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  private async signedFetch(
    method: 'GET' | 'PUT',
    key: string,
    body?: Buffer,
  ): Promise<Response> {
    const { createHash, createHmac } = await import('node:crypto');

    const url = new URL(`${this.config.endpoint}/${this.config.bucket}/${key}`);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const payloadHash = createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex');

    const canonicalHeaders =
      `host:${url.host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.config.region}/s3/aws4_request`;
    const toSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (key: Buffer | string, data: string): Buffer =>
      createHmac('sha256', key).update(data).digest();

    // The signing key is the secret walked through date, region and service —
    // spelled out step by step because a nested one-liner here is unreadable
    // and this is the part that is painful to debug when it is wrong.
    const dateKey = hmac(`AWS4${this.config.secretAccessKey}`, dateStamp);
    const regionKey = hmac(dateKey, this.config.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');

    const signature = hmac(signingKey, toSign).toString('hex');

    return fetch(url, {
      method,
      headers: {
        Authorization:
          `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
      ...(body === undefined ? {} : { body: new Uint8Array(body) }),
    });
  }
}
