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
  constructor(
    private readonly products: ProductReader,
    private readonly groups: readonly ModifierGroup[],
  ) {}

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

    const known = this.groups
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
