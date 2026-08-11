export {
  type OutboxEntry,
  type FlushOutcome,
  MAX_ATTEMPTS,
  classify,
  backoffMs,
  nextEntry,
} from './lib/outbox';
