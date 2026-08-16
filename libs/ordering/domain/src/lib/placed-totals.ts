import { type Order } from './order';
import { Money, type CurrencyCode, type MoneyError, ok } from '@itadaki/shared/domain';

/**
 * Lo que la mesa ya mandó a la cocina, por comensal y en total.
 *
 * El carrito se vacía al enviar — tiene que vaciarse, o la mesa mandaría todo
 * dos veces — pero eso no significa que la mesa no haya consumido nada. Sin
 * esto la pantalla mostraba $0 apenas el pedido salía, que es justo cuando
 * más plata debe.
 *
 * Los platos cancelados no se cobran: nunca se sirvieron.
 */
export function placedTotals(orders: readonly Order[], currency: CurrencyCode) {
  const porComensal = new Map<string, Money>();
  let total = Money.zero(currency);

  for (const order of orders) {
    if (order.status === 'CANCELLED') continue;

    for (const item of order.items) {
      if (order.statusOf(item.id) === 'CANCELLED') continue;

      // El unitario más sus modificadores, congelado al enviar: el mismo
      // criterio que usa la cuenta, para que los dos números coincidan.
      const unit = item.modifiers.reduce(
        (acc, modifier) => acc.flatMap((sum) => sum.add(modifier.priceDelta)),
        ok<Money, MoneyError>(item.product.unitPrice),
      );
      const unitario = unit.isOk() ? unit.value : item.product.unitPrice;
      const linea = unitario.multiply(item.quantity);
      if (linea.isErr()) continue;

      const previo = porComensal.get(item.dinerId) ?? Money.zero(currency);
      const sumado = previo.add(linea.value);
      if (sumado.isOk()) porComensal.set(item.dinerId, sumado.value);

      const acumulado = total.add(linea.value);
      if (acumulado.isOk()) total = acumulado.value;
    }
  }

  return { porComensal, total };
}
