import { Money } from '@itadaki/shared/domain';
import { Order } from './order';
import { OrderItem } from './order-item';
import { canTransition } from './order-status';
import { placedTotals } from './placed-totals';

const ars = (minor: number): Money => {
  const result = Money.of(minor, 'ARS');
  if (result.isErr()) throw new Error('importe inválido en el test');
  return result.value;
};

const item = (
  id: string,
  dinerId: string,
  unitMinor: number,
  quantity = 1,
  modifiers: ReadonlyArray<{ modifierId: string; name: string; priceDelta: Money }> = [],
): OrderItem => {
  const creado = OrderItem.create({
    id,
    dinerId,
    quantity,
    notes: '',
    product: {
      productId: `p-${id}`,
      name: `plato ${id}`,
      unitPrice: ars(unitMinor),
      capturedAt: new Date('2026-08-16T21:00:00Z'),
    },
    modifiers,
  });
  if (creado.isErr()) throw new Error('no se pudo armar el plato del test');
  return creado.value;
};

const order = (
  items: readonly OrderItem[],
  status: 'SENT' | 'READY' | 'DELIVERED' | 'CANCELLED' = 'SENT',
  itemStatuses: Record<string, string> = {},
): Order =>
  Order.restore({
    id: `o-${items[0]?.id ?? 'x'}`,
    clientRequestId: 'c1',
    sessionId: 's1',
    currency: 'ARS',
    items,
    status,
    history: [],
    itemProgress: items.map((i) => ({
      itemId: i.id,
      status: (itemStatuses[i.id] ?? status) as never,
    })),
  });

describe('lo que la mesa ya mandó a la cocina', () => {
  it('suma lo enviado aunque el carrito esté vacío', () => {
    // El carrito se vacía al enviar — tiene que vaciarse, o la mesa mandaría
    // todo dos veces — pero eso no significa que no haya consumido nada.
    const { total } = placedTotals([order([item('a', 'd1', 820_000, 2)])], 'ARS');
    expect(total.amountInMinorUnits).toBe(1_640_000);
  });

  it('acumula varios pedidos en vez de reemplazarlos', () => {
    // Pedir el postre después no borra lo que la mesa ya debe.
    const { total } = placedTotals(
      [order([item('a', 'd1', 820_000)]), order([item('b', 'd1', 260_000)])],
      'ARS',
    );
    expect(total.amountInMinorUnits).toBe(1_080_000);
  });

  it('reparte por comensal para la cuenta dividida', () => {
    const { porComensal } = placedTotals(
      [order([item('a', 'ana', 820_000), item('b', 'beto', 340_000)])],
      'ARS',
    );
    expect(porComensal.get('ana')?.amountInMinorUnits).toBe(820_000);
    expect(porComensal.get('beto')?.amountInMinorUnits).toBe(340_000);
  });

  it('incluye los modificadores en el precio', () => {
    const conExtra = item('a', 'd1', 820_000, 1, [{ modifierId: 'm1', name: 'huevo', priceDelta: ars(50_000) }]);
    const { total } = placedTotals([order([conExtra])], 'ARS');
    expect(total.amountInMinorUnits).toBe(870_000);
  });

  it('no cobra un pedido cancelado', () => {
    // Nunca se sirvió: cobrarlo sería cobrar comida que no salió.
    const { total } = placedTotals([order([item('a', 'd1', 820_000)], 'CANCELLED')], 'ARS');
    expect(total.amountInMinorUnits).toBe(0);
  });

  it('no cobra un plato cancelado dentro de un pedido que sigue', () => {
    const parcial = order([item('a', 'd1', 820_000), item('b', 'd1', 340_000)], 'SENT', {
      b: 'CANCELLED',
    });
    const { total } = placedTotals([parcial], 'ARS');
    expect(total.amountInMinorUnits).toBe(820_000);
  });

  it('sigue contando un plato ya entregado', () => {
    // Servirlo no lo borra de la cuenta: la mesa lo comió y lo debe.
    const { total } = placedTotals([order([item('a', 'd1', 820_000)], 'DELIVERED')], 'ARS');
    expect(total.amountInMinorUnits).toBe(820_000);
  });

  it('da cero cuando la mesa todavía no mandó nada', () => {
    const { total, porComensal } = placedTotals([], 'ARS');
    expect(total.amountInMinorUnits).toBe(0);
    expect(porComensal.size).toBe(0);
  });
});

describe('cocina terminó no es lo mismo que llegó a la mesa', () => {
  it('el plato listo todavía tiene que ser entregado', () => {
    // READY es "salió de la cocina", DELIVERED es "está en la mesa". Sin ese
    // paso el mozo perdía el plato de su lista antes de llevarlo.
    expect(canTransition('READY', 'DELIVERED')).toBe(true);
  });

  it('no se puede saltar de en preparación a entregado', () => {
    expect(canTransition('IN_PREP', 'DELIVERED')).toBe(false);
  });

  it('entregado es el final del camino', () => {
    expect(canTransition('DELIVERED', 'READY')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });
});
