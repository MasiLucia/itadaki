export {
  type ProductReader,
  type ProductWriter,
  type CategoryReader,
  type CategoryWriter,
  type PriceAuditLog,
  type CatalogEventPublisher,
  type RepositoryError,
} from './lib/ports';
export {
  setProductAvailability,
  type SetProductAvailabilityCommand,
} from './lib/set-product-availability';
