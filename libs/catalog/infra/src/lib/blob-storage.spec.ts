import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskBlobStorage, S3BlobStorage } from './blob-storage';

describe('image bytes on the local disk', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'itadaki-blobs-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('round-trips what was written', async () => {
    const storage = new DiskBlobStorage(root);
    await storage.put('itadaki/foto-1/original', Buffer.from('unos bytes'));

    expect((await storage.get('itadaki/foto-1/original')).toString()).toBe('unos bytes');
  });

  it('creates the folders a key implies', async () => {
    // Nothing calls mkdir first; the key is the whole instruction.
    const storage = new DiskBlobStorage(root);
    await storage.put('otro-resto/foto-9/640.webp', Buffer.from('x'));

    expect((await storage.get('otro-resto/foto-9/640.webp')).toString()).toBe('x');
  });

  it('keeps restaurants in separate places', async () => {
    const storage = new DiskBlobStorage(root);
    await storage.put('resto-a/foto/original', Buffer.from('de A'));
    await storage.put('resto-b/foto/original', Buffer.from('de B'));

    expect((await storage.get('resto-a/foto/original')).toString()).toBe('de A');
    expect((await storage.get('resto-b/foto/original')).toString()).toBe('de B');
  });

  it('fails when the image is not there', async () => {
    await expect(new DiskBlobStorage(root).get('no/existe/original')).rejects.toThrow();
  });
});

describe('image bytes in a bucket', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  const configure = (): void => {
    process.env['S3_ENDPOINT'] = 'https://cuenta.r2.cloudflarestorage.com';
    process.env['S3_BUCKET'] = 'itadaki';
    process.env['S3_ACCESS_KEY_ID'] = 'clave';
    process.env['S3_SECRET_ACCESS_KEY'] = 'secreta';
  };

  it('is absent until every setting is there', () => {
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      delete process.env[key];
    }
    expect(S3BlobStorage.fromEnvironment()).toBeNull();

    // Half-configured is not configured: it would fail on the first upload.
    process.env['S3_BUCKET'] = 'itadaki';
    expect(S3BlobStorage.fromEnvironment()).toBeNull();

    configure();
    expect(S3BlobStorage.fromEnvironment()).not.toBeNull();
  });

  it('signs the upload rather than sending the secret', async () => {
    configure();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));

    await S3BlobStorage.fromEnvironment()?.put('itadaki/foto/original', Buffer.from('bytes'));

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://cuenta.r2.cloudflarestorage.com/itadaki/itadaki/foto/original');

    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toContain('AWS4-HMAC-SHA256');
    expect(headers['Authorization']).toContain('Signature=');
    // The secret derives the signature and must never travel itself.
    expect(JSON.stringify(headers)).not.toContain('secreta');
  });

  it('hashes the body it is about to send', async () => {
    configure();
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 200 }));

    await S3BlobStorage.fromEnvironment()?.put('k', Buffer.from('bytes'));

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    // sha256 of "bytes": S3 rejects the request if this does not match.
    expect(headers['x-amz-content-sha256']).toHaveLength(64);
  });

  it('says so when the bucket rejects the upload', async () => {
    // Swallowing this would leave a menu photo silently missing.
    configure();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denegado', { status: 403 }));

    await expect(
      S3BlobStorage.fromEnvironment()?.put('k', Buffer.from('x')),
    ).rejects.toThrow('403');
  });

  it('reads the bytes back', async () => {
    configure();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const bytes = await S3BlobStorage.fromEnvironment()?.get('itadaki/foto/640.webp');
    expect([...(bytes ?? [])]).toEqual([1, 2, 3]);
  });
});
