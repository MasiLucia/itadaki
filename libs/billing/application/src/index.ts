export {
  type BillReader,
  type BillWriter,
  type BillRepositoryError,
  type ExchangeRateProvider,
} from './lib/ports';
export { closeBill, type CloseBillCommand, type CloseBillError } from './lib/close-bill';
