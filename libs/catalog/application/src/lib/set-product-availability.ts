import { type Product } from '@itadaki/catalog/domain';
import { type Result } from '@itadaki/shared/domain';
import { type CatalogEventPublisher, type ProductWriter, type RepositoryError } from './ports';

export interface SetProductAvailabilityCommand {
  readonly tenantId: string;
  readonly productId: string;
  readonly available: boolean;
}

/**
 * The "86" toggle. Persists first, then broadcasts — a dropped broadcast
 * leaves stale menus, but a broadcast without persistence would resurrect
 * the product on the next refresh.
 */
export function setProductAvailability(deps: {
  products: ProductWriter;
  events: CatalogEventPublisher;
}) {
  return async (command: SetProductAvailabilityCommand): Promise<Result<Product, RepositoryError>> => {
    const saved = await deps.products.setAvailability(
      command.tenantId,
      command.productId,
      command.available,
    );

    if (saved.isErr()) {
      return saved;
    }

    await deps.events.productAvailabilityChanged({
      tenantId: command.tenantId,
      productId: command.productId,
      available: command.available,
    });

    return saved;
  };
}
