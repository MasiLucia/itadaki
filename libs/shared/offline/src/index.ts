export {
  type OutboxEntry,
  type FlushOutcome,
  MAX_ATTEMPTS,
  classify,
  backoffMs,
  nextEntry,
} from './lib/outbox';
export { OutboxDb, type OutboxDbOptions, type SendFn } from './lib/outbox-db';
