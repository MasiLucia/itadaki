import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { reeditImage, uploadImage } from '@itadaki/catalog/application/server';
import { mimeForFormat, validateUpload } from '@itadaki/catalog/infra';
import { type Response } from 'express';
import { z } from 'zod';
import { Public, RequirePermission, TenantId } from './auth';
import { ImagesService } from './images.service';

const editParamsSchema = z.object({
  crop: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    size: z.number().gt(0).max(1),
  }),
  depthOfField: z
    .object({
      focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
      sharpRadius: z.number().min(0).max(1),
      blurIntensity: z.number().min(0).max(1),
    })
    .nullable()
    .default(null),
  adjustments: z
    .object({
      sharpen: z.number().min(0).max(5).default(0),
      brightness: z.number().min(0.1).max(3).default(1),
      saturation: z.number().min(0.1).max(3).default(1),
    })
    .default({ sharpen: 0, brightness: 1, saturation: 1 }),
});

const uploadSchema = z.object({
  imageId: z.string().min(1).max(64),
  alt: z.string().max(200).default(''),
  /** Base64 payload; the real type is checked against magic bytes, not this. */
  data: z.string().min(1),
  params: editParamsSchema,
});

const reeditSchema = z.object({
  alt: z.string().max(200).optional(),
  params: editParamsSchema,
});

@Controller('images')
export class ImagesController {
  constructor(private readonly images: ImagesService) {}

  @RequirePermission('menu:write')
  @Post()
  async upload(@Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = uploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const buffer = Buffer.from(parsed.data.data, 'base64');
    const accepted = validateUpload(buffer);
    if (accepted.isErr()) {
      throw new HttpException(accepted.error, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const run = uploadImage({ images: this.images.store, renderer: this.images.renderer });
    const result = await run({
      tenantId: tenantId,
      imageId: parsed.data.imageId,
      original: buffer,
      params: parsed.data.params,
      alt: parsed.data.alt,
    });

    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return { id: result.value.id, imageSet: result.value.imageSet, params: result.value.params };
  }

  /** Re-renders from the stored original: no re-upload, no generational loss. */
  @RequirePermission('menu:write')
  @Post(':id/reedit')
  async reedit(@Param('id') imageId: string, @Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = reeditSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const run = reeditImage({ images: this.images.store, renderer: this.images.renderer });
    const result = await run({
      tenantId: tenantId,
      imageId,
      params: parsed.data.params,
      ...(parsed.data.alt === undefined ? {} : { alt: parsed.data.alt }),
    });

    if (result.isErr()) {
      const status = result.error.kind === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.UNPROCESSABLE_ENTITY;
      throw new HttpException(result.error, status);
    }
    return { id: result.value.id, imageSet: result.value.imageSet, params: result.value.params };
  }

  @RequirePermission('menu:read')
  @Get(':id')
  async describe(@Param('id') imageId: string, @TenantId() tenantId: string) {
    const found = await this.images.store.findById(tenantId, imageId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.NOT_FOUND);
    }
    return { id: found.value.id, imageSet: found.value.imageSet, params: found.value.params };
  }

  /** Serves a rendered variant straight from the store. */
  @Public()
  @Get(':id/:file')
  async variant(
    @Param('id') imageId: string,
    @Param('file') file: string,
    @Res() response: Response,
    @TenantId({ publicFallback: true }) tenantId: string,
  ): Promise<void> {
    const extension = file.split('.').pop() ?? '';
    if (!['avif', 'webp', 'jpeg'].includes(extension)) {
      throw new HttpException('unsupported variant', HttpStatus.BAD_REQUEST);
    }

    const bytes = await this.images.store.readVariant(tenantId, imageId, file);
    if (bytes.isErr()) {
      throw new HttpException(bytes.error, HttpStatus.NOT_FOUND);
    }

    response.setHeader('Content-Type', mimeForFormat(extension as 'avif' | 'webp' | 'jpeg'));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.send(bytes.value);
  }
}
