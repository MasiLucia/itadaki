import { type ProductReader } from '@itadaki/catalog/application';
import { type ModifierGroup } from '@itadaki/catalog/domain';
import {
  type LinePricer,
  type PricedLine,
  type SubmitOrderError,
  type SubmitOrderLine,
} from '@itadaki/ordering/application';
import { type ModifierSnapshot } from '@itadaki/ordering/domain';
import { type Result, err, ok } from '@itadaki/shared/domain';

/**
 * Prices a submitted line against the live catalog and captures the snapshot.
 * The client sends product ids only — never amounts — so a tampered payload
 * cannot change what the diner is charged.
 */
export class CatalogLinePricer implements LinePricer {
  /**
   * Los grupos pueden venir fijos o consultarse por restaurante.
   *
   * Una función y no un array: el precio de un extra tiene que salir de lo
   * que el restaurante cargó, y con un array congelado al arrancar la API
   * seguía cobrando lo que decía el código aunque el dueño lo cambiara.
   */
  constructor(
    private readonly products: ProductReader,
    private readonly groupsFor:
      | readonly ModifierGroup[]
      | ((tenantId: string) => Promise<readonly ModifierGroup[]>),
  ) {}

  private async groupsOf(tenantId: string): Promise<readonly ModifierGroup[]> {
    return typeof this.groupsFor === 'function'
      ? this.groupsFor(tenantId)
      : this.groupsFor;
  }

  async price(
    tenantId: string,
    line: SubmitOrderLine,
  ): Promise<Result<PricedLine, SubmitOrderError>> {
    const found = await this.products.findById(tenantId, line.productId);
    if (found.isErr()) {
      return err({ kind: 'PRODUCT_UNAVAILABLE', productId: line.productId });
    }

    const product = found.value;
    if (!product.available) {
      return err({ kind: 'PRODUCT_UNAVAILABLE', productId: line.productId });
    }

    const known = (await this.groupsOf(tenantId))
      .filter((group) => group.productId === product.id)
      .flatMap((group) => group.modifiers);

    const modifiers: ModifierSnapshot[] = [];
    for (const modifierId of line.modifierIds) {
      const modifier = known.find((candidate) => candidate.id === modifierId);
      if (modifier === undefined || !modifier.available) {
        return err({ kind: 'PRODUCT_UNAVAILABLE', productId: modifierId });
      }
      modifiers.push({
        modifierId: modifier.id,
        name: modifier.name,
        priceDelta: modifier.priceDelta,
      });
    }

    return ok({
      product: {
        productId: product.id,
        name: product.name,
        unitPrice: product.price,
        capturedAt: new Date(),
      },
      modifiers,
    });
  }
}
