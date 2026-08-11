import { type Order } from '@itadaki/ordering/domain';
import { type Money } from '@itadaki/shared/domain';
import { z } from 'zod';

/** Validation happens at the edge; nothing untyped reaches a use case. */
export const submitOrderSchema = z.object({
  sessionId: z.string().min(1).max(64),
  dinerId: z.string().min(1).max(64),
  clientRequestId: z.string().min(1).max(128),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1).max(64),
        quantity: z.number().int().min(1).max(99),
        notes: z.string().max(280).default(''),
        modifierIds: z.array(z.string().min(1).max(64)).max(10).default([]),
      }),
    )
    .min(1)
    .max(50),
});

export const advanceOrderSchema = z.object({
  next: z.enum(['ACCEPTED', 'IN_PREP', 'READY', 'DELIVERED', 'CANCELLED']),
  actorId: z.string().min(1).max(64).default('staff'),
  /** Present when the kitchen is advancing one dish rather than the ticket. */
  itemId: z.string().min(1).max(64).optional(),
});

export const availabilitySchema = z.object({
  available: z.boolean(),
});

export interface MoneyDto {
  readonly amountInMinorUnits: number;
  readonly currency: string;
}

export const toMoneyDto = (money: Money): MoneyDto => ({
  amountInMinorUnits: money.amountInMinorUnits,
  currency: money.currency,
});

export interface OrderDto {
  readonly id: string;
  readonly sessionId: string;
  readonly clientRequestId: string;
  readonly status: string;
  readonly currency: string;
  readonly total: MoneyDto;
  readonly items: ReadonlyArray<{
    readonly id: string;
    readonly dinerId: string;
    readonly name: string;
    readonly quantity: number;
    readonly notes: string;
    /** Where this dish is, which may be ahead of or behind the ticket. */
    readonly status: string;
    readonly unitPrice: MoneyDto;
    readonly modifiers: ReadonlyArray<{ readonly name: string; readonly priceDelta: MoneyDto }>;
  }>;
  readonly placedAt: string | null;
}

export function toOrderDto(order: Order): OrderDto {
  const total = order.total();

  return {
    id: order.id,
    sessionId: order.sessionId,
    clientRequestId: order.clientRequestId,
    status: order.status,
    currency: order.currency,
    total: total.isOk()
      ? toMoneyDto(total.value)
      : { amountInMinorUnits: 0, currency: order.currency },
    items: order.items.map((item) => ({
      id: item.id,
      dinerId: item.dinerId,
      name: item.product.name,
      quantity: item.quantity,
      notes: item.notes,
      status: order.statusOf(item.id),
      unitPrice: toMoneyDto(item.product.unitPrice),
      modifiers: item.modifiers.map((modifier) => ({
        name: modifier.name,
        priceDelta: toMoneyDto(modifier.priceDelta),
      })),
    })),
    placedAt: order.history.find((entry) => entry.status === 'SENT')?.at.toISOString() ?? null,
  };
}
