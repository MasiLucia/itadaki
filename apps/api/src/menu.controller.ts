import { ALLERGENS, DIET_TAGS, htmlToMenuText } from '@itadaki/catalog/domain';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { setProductAvailability } from '@itadaki/catalog/application';
import { Public, RequirePermission, TenantId } from './auth';
import { fetchPage } from './fetch-page';
import { CatalogService } from './catalog.service';
import { ImagesService } from './images.service';
import { RealtimeGateway } from './realtime.gateway';
import { Money } from '@itadaki/shared/domain';
import { z } from 'zod';
import { availabilitySchema, toMoneyDto } from './contracts';

/** URL-safe id from a free-text name, accents folded. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug === '' ? 'item' : slug;
}

@Controller('menu')
export class MenuController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly realtime: RealtimeGateway,
    private readonly images: ImagesService,
  ) {}

  // The carte is public: a diner scans a QR and has no account.
  @Public()
  @Get()
  async getMenu(@TenantId({ publicFallback: true }) tenantId: string) {
    const [categories, products] = await Promise.all([
      this.catalog.categories.list(tenantId),
      this.catalog.products.list(tenantId, {}),
    ]);

    if (categories.isErr() || products.isErr()) {
      throw new HttpException('catalog unavailable', HttpStatus.BAD_GATEWAY);
    }

    // Images are looked up per product; a product without one renders the
    // striped placeholder rather than blocking the menu.
    const withImages = await Promise.all(
      products.value.map(async (product) => {
        const found = await this.images.store.findById(tenantId, product.id);
        return { product, imageSet: found.isOk() ? found.value.imageSet : null };
      }),
    );

    return {
      categories: categories.value.map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
      })),
      products: withImages.map(({ product, imageSet }) => ({
        id: product.id,
        imageSet,
        categoryId: product.categoryId,
        name: product.name,
        description: product.description,
        price: toMoneyDto(product.price),
        allergens: product.allergens,
        diets: product.diets,
        available: product.available,
        estimatedPrepMinutes: product.estimatedPrepMinutes,
        station: product.station,
      })),
      // De la base, no del fixture: el punto de cocción del bife lo define
      // cada restaurante, no el repositorio.
      modifierGroups: (await this.catalog.modifierGroups(tenantId)).map((group) => ({
        id: group.id,
        productId: group.productId,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        modifiers: group.modifiers.map((modifier) => ({
          id: modifier.id,
          name: modifier.name,
          priceDelta: toMoneyDto(modifier.priceDelta),
          available: modifier.available,
        })),
      })),
    };
  }

  /** Creates a category. Names are free text: not every restaurant is Japanese. */
  @RequirePermission('menu:write')
  @Post('categories')
  async createCategory(@Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = z
      .object({ name: z.string().min(1).max(40) })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

        const existing = await this.catalog.categories.list(tenantId);
    const count = existing.isOk() ? existing.value.length : 0;

    const saved = await this.catalog.categoryWriter.save({
      id: slugify(parsed.data.name),
      tenantId,
      name: parsed.data.name,
      sortOrder: count + 1,
      availability: null,
    });

    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.CONFLICT);
    }
    return { id: saved.value.id, name: saved.value.name, sortOrder: saved.value.sortOrder };
  }

  @RequirePermission('menu:write')
  @Patch('categories/:id')
  async renameCategory(
    @Param('id') categoryId: string,
    @Body() body: unknown,
    @TenantId() tenantId: string,
  ) {
    const parsed = z.object({ name: z.string().min(1).max(40) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

        const all = await this.catalog.categories.list(tenantId);
    if (all.isErr()) {
      throw new HttpException(all.error, HttpStatus.BAD_GATEWAY);
    }

    const current = all.value.find((category) => category.id === categoryId);
    if (current === undefined) {
      throw new HttpException({ kind: 'NOT_FOUND', id: categoryId }, HttpStatus.NOT_FOUND);
    }

    // The id stays put so dishes keep pointing at it; only the label changes.
    const saved = await this.catalog.categoryWriter.save({ ...current, name: parsed.data.name });
    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.CONFLICT);
    }
    return { id: saved.value.id, name: saved.value.name };
  }

  @RequirePermission('menu:write')
  @Post('categories/reorder')
  async reorderCategories(@Body() body: unknown, @TenantId() tenantId: string) {
    const parsed = z
      .object({ orderedIds: z.array(z.string().min(1)).min(1).max(50) })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const result = await this.catalog.categoryWriter.reorder(
      tenantId,
      parsed.data.orderedIds,
    );
    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.CONFLICT);
    }
    return { ok: true };
  }

  @RequirePermission('menu:write')
  @Delete('categories/:id')
  async deleteCategory(@Param('id') categoryId: string, @TenantId() tenantId: string) {
    const result = await this.catalog.categoryWriter.remove(tenantId, categoryId);
    if (result.isErr()) {
      const status = result.error.kind === 'NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.CONFLICT;
      throw new HttpException(result.error, status);
    }
    return { ok: true };
  }

  /** Moves a dish to another category, or edits its name, price or station. */
  @RequirePermission('menu:write')
  @Patch('products/:id')
  async updateProduct(
    @Param('id') productId: string,
    @Body() body: unknown,
    @TenantId() tenantId: string,
  ) {
    const parsed = z
      .object({
        categoryId: z.string().min(1).max(64).optional(),
        name: z.string().min(1).max(60).optional(),
        description: z.string().max(140).optional(),
        priceMinor: z.number().int().min(0).optional(),
        station: z.enum(['GRILL', 'COLD', 'BAR', 'DESSERT']).optional(),
        diets: z.array(z.enum(DIET_TAGS)).max(4).optional(),
        allergens: z.array(z.enum(ALLERGENS)).max(10).optional(),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

        const found = await this.catalog.products.findById(tenantId, productId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.NOT_FOUND);
    }

    const current = found.value;
    let price = current.price;
    if (parsed.data.priceMinor !== undefined) {
      const built = Money.of(parsed.data.priceMinor, current.price.currency);
      if (built.isErr()) {
        throw new HttpException(built.error, HttpStatus.BAD_REQUEST);
      }
      price = built.value;
    }

    const saved = await this.catalog.products.save({
      ...current,
      categoryId: parsed.data.categoryId ?? current.categoryId,
      name: parsed.data.name ?? current.name,
      description: parsed.data.description ?? current.description,
      station: parsed.data.station ?? current.station,
      diets: parsed.data.diets ?? current.diets,
      allergens: parsed.data.allergens ?? current.allergens,
      price,
    });

    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.CONFLICT);
    }
    return {
      id: saved.value.id,
      name: saved.value.name,
      categoryId: saved.value.categoryId,
      price: toMoneyDto(saved.value.price),
      diets: saved.value.diets,
      allergens: saved.value.allergens,
    };
  }

  /** Creates a dish from the admin panel. */
  @RequirePermission('menu:write')
  @Post('products')
  async createProduct(@Body() body: unknown, @TenantId() tenantId: string) {
    const schema = z.object({
      name: z.string().min(1).max(60),
      description: z.string().max(140).default(''),
      priceMinor: z.number().int().min(0),
      categoryId: z.string().min(1).max(64),
      station: z.enum(['GRILL', 'COLD', 'BAR', 'DESSERT']).default('COLD'),
      prepMinutes: z.number().int().min(1).max(120).default(10),
      // Sin esto un plato nace invisible para quien filtra la carta por
      // vegano o sin gluten: el filtro existe desde el principio y no había
      // forma de cargar el dato que necesita.
      diets: z.array(z.enum(DIET_TAGS)).max(4).default([]),
      allergens: z.array(z.enum(ALLERGENS)).max(10).default([]),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

        const price = Money.of(parsed.data.priceMinor, 'ARS');
    if (price.isErr()) {
      throw new HttpException(price.error, HttpStatus.BAD_REQUEST);
    }

    // Suffixed so two dishes with the same words can coexist.
    const id = `${slugify(parsed.data.name)}-${Date.now().toString(36)}`;

    const saved = await this.catalog.products.save({
      id,
      tenantId,
      categoryId: parsed.data.categoryId,
      name: parsed.data.name,
      description: parsed.data.description,
      price: price.value,
      images: null,
      allergens: parsed.data.allergens,
      diets: parsed.data.diets,
      estimatedPrepMinutes: parsed.data.prepMinutes,
      available: true,
      station: parsed.data.station,
    });

    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.CONFLICT);
    }
    return { id: saved.value.id, name: saved.value.name };
  }

  /** The "86" toggle: persists, then pushes to every open menu. */
  @RequirePermission('menu:write')
  @Post('products/:id/availability')
  async setAvailability(
    @Param('id') productId: string,
    @Body() body: unknown,
    @TenantId() tenantId: string,
  ) {
    const parsed = availabilitySchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

        const run = setProductAvailability({
      products: this.catalog.products,
      events: this.realtime,
    });

    const result = await run({ tenantId, productId, available: parsed.data.available });
    if (result.isErr()) {
      throw new HttpException(result.error, HttpStatus.NOT_FOUND);
    }

    return { id: result.value.id, available: result.value.available };
  }

  /**
   * Los grupos de opciones de un plato: punto de cocción, guarnición, tamaño.
   *
   * Hasta acá vivían en un archivo del código, iguales para todos los
   * restaurantes: una parrilla no podía ofrecer sus propios puntos de cocción
   * ni una cafetería sus tamaños. Ahora los define cada uno.
   *
   * El grupo entero viaja junto porque sus opciones son un conjunto: "jugoso,
   * a punto, cocido" sólo tiene sentido completo, y guardarlas de a una
   * dejaría la carta a medio camino si algo falla en el medio.
   */
  @RequirePermission('menu:write')
  @Post('products/:id/options')
  async saveOptions(
    @Param('id') productId: string,
    @Body() body: unknown,
    @TenantId() tenantId: string,
  ) {
    const schema = z.object({
      id: z.string().min(1).max(64).optional(),
      name: z.string().min(1).max(40),
      minSelections: z.number().int().min(0).max(10),
      maxSelections: z.number().int().min(1).max(10),
      options: z
        .array(
          z.object({
            name: z.string().min(1).max(40),
            priceDeltaMinor: z.number().int().min(-1_000_000).max(1_000_000).default(0),
          }),
        )
        .min(1)
        .max(20),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    // Pedir un mínimo mayor que el máximo deja un grupo que nadie puede
    // completar: el plato se vuelve imposible de pedir.
    if (parsed.data.minSelections > parsed.data.maxSelections) {
      throw new HttpException({ kind: 'MIN_ABOVE_MAX' }, HttpStatus.BAD_REQUEST);
    }

    if (this.catalog.modifiers === null) {
      throw new HttpException({ kind: 'NOT_SUPPORTED' }, HttpStatus.NOT_IMPLEMENTED);
    }

    const found = await this.catalog.products.findById(tenantId, productId);
    if (found.isErr()) {
      throw new HttpException(found.error, HttpStatus.NOT_FOUND);
    }

    const groupId = parsed.data.id ?? `${slugify(parsed.data.name)}-${Date.now().toString(36)}`;
    const modifiers = [];
    for (const [index, option] of parsed.data.options.entries()) {
      const delta = Money.of(option.priceDeltaMinor, found.value.price.currency);
      if (delta.isErr()) {
        throw new HttpException(delta.error, HttpStatus.BAD_REQUEST);
      }
      modifiers.push({
        id: `${groupId}-${index}`,
        name: option.name,
        priceDelta: delta.value,
        available: true,
      });
    }

    const saved = await this.catalog.modifiers.save(tenantId, {
      id: groupId,
      productId,
      name: parsed.data.name,
      minSelections: parsed.data.minSelections,
      maxSelections: parsed.data.maxSelections,
      modifiers,
    });

    if (saved.isErr()) {
      throw new HttpException(saved.error, HttpStatus.BAD_GATEWAY);
    }

    return { id: saved.value.id, name: saved.value.name };
  }

  @RequirePermission('menu:write')
  @Delete('options/:id')
  async removeOptions(@Param('id') groupId: string, @TenantId() tenantId: string) {
    if (this.catalog.modifiers === null) {
      throw new HttpException({ kind: 'NOT_SUPPORTED' }, HttpStatus.NOT_IMPLEMENTED);
    }

    const removed = await this.catalog.modifiers.remove(tenantId, groupId);
    if (removed.isErr()) {
      throw new HttpException(removed.error, HttpStatus.NOT_FOUND);
    }

    return { removed: groupId };
  }

  /**
   * Trae la carta que el restaurante ya tiene publicada en su página.
   *
   * Devuelve texto y no platos: cae en el mismo cuadro que el pegado y la
   * planilla, pasa por la misma vista previa y se corrige a mano antes de
   * guardar. Una página no es una fuente confiable —tiene el menú de
   * navegación, el teléfono, el horario— así que interpretarla sin que nadie
   * la mire sería publicar "Contacto" como sección.
   *
   * Baja del lado del servidor porque el navegador no puede: el sitio ajeno no
   * manda CORS para nosotros. Eso pone al servidor a pedir una URL que escribe
   * otro, y de ahí la guarda contra la red interna en `fetchPage`.
   */
  @RequirePermission('menu:write')
  @Post('import/fetch')
  async importFromUrl(@Body() body: unknown) {
    const parsed = z.object({ url: z.string().min(1).max(2000) }).safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const page = await fetchPage(parsed.data.url);
    if (!page.ok) {
      throw new HttpException(page.error, HttpStatus.BAD_REQUEST);
    }

    return { text: htmlToMenuText(page.html) };
  }

  /**
   * Carga una carta entera de una vez.
   *
   * Un restaurante que ya trabaja no va a cargar sesenta platos de a uno para
   * probar el sistema: abandona antes de llegar al décimo. Esto recibe lo que
   * el navegador ya interpretó y confirmó en pantalla — el parseo vive en el
   * dominio y corre allá, para que nadie guarde a ciegas.
   *
   * Las categorías se crean primero porque los platos las referencian, y una
   * que ya existe se reusa: importar dos veces no debe duplicar "ENTRADAS".
   */
  @RequirePermission('menu:write')
  @Post('import')
  async importMenu(@Body() body: unknown, @TenantId() tenantId: string) {
    const schema = z.object({
      dishes: z
        .array(
          z.object({
            name: z.string().min(1).max(60),
            description: z.string().max(140).default(''),
            priceMinor: z.number().int().min(0),
            category: z.string().min(1).max(40),
          }),
        )
        .min(1)
        .max(300),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new HttpException(parsed.error.issues, HttpStatus.BAD_REQUEST);
    }

    const existing = await this.catalog.categories.list(tenantId);
    if (existing.isErr()) {
      throw new HttpException(existing.error, HttpStatus.BAD_GATEWAY);
    }

    // Por nombre en minúsculas: "Entradas" y "ENTRADAS" son la misma sección.
    const byName = new Map(existing.value.map((c) => [c.name.toLowerCase(), c.id]));
    let sortOrder = existing.value.length;

    for (const name of new Set(parsed.data.dishes.map((d) => d.category))) {
      if (byName.has(name.toLowerCase())) continue;

      const created = await this.catalog.categoryWriter.save({
        id: `${slugify(name)}-${Date.now().toString(36)}-${sortOrder}`,
        tenantId,
        name,
        sortOrder: sortOrder++,
        availability: null,
      });
      if (created.isOk()) byName.set(name.toLowerCase(), created.value.id);
    }

    const imported: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];

    for (const [index, dish] of parsed.data.dishes.entries()) {
      const categoryId = byName.get(dish.category.toLowerCase());
      if (categoryId === undefined) {
        failed.push({ name: dish.name, reason: 'CATEGORIA_NO_CREADA' });
        continue;
      }

      const price = Money.of(dish.priceMinor, 'ARS');
      if (price.isErr()) {
        failed.push({ name: dish.name, reason: 'PRECIO_INVALIDO' });
        continue;
      }

      // El índice desempata dos platos con el mismo nombre en la misma carta.
      const saved = await this.catalog.products.save({
        id: `${slugify(dish.name)}-${Date.now().toString(36)}-${index}`,
        tenantId,
        categoryId,
        name: dish.name,
        description: dish.description,
        price: price.value,
        images: null,
        allergens: [],
        diets: [],
        estimatedPrepMinutes: 10,
        available: true,
        station: 'COLD',
      });

      if (saved.isOk()) imported.push(saved.value.name);
      else failed.push({ name: dish.name, reason: 'NO_SE_PUDO_GUARDAR' });
    }

    return { imported: imported.length, failed };
  }
}
