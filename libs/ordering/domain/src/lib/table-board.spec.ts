import {
  type BoardTicket,
  type TableCard,
  groupByTable,
  layoutFor,
  splitByUrgency,
} from './table-board';

const plato = (
  id: string,
  status: string,
  name = 'plato',
  station = 'PARRILLA',
): BoardTicket['items'][number] => ({ id, status, name, quantity: 1, notes: '', station });

const comanda = (overrides: Partial<BoardTicket> = {}): BoardTicket => ({
  id: 'o1',
  sessionId: 's1',
  tableId: 'mesa-1',
  status: 'SENT',
  placedAt: '2026-08-15T21:00:00.000Z',
  items: [plato('i1', 'SENT')],
  ...overrides,
});

describe('lo que la cocina ve de una mesa', () => {
  it('junta en una tarjeta lo que la mesa pidió dos veces', () => {
    // Al cocinero no le importa cuántas veces pidió la mesa 1: le importa
    // qué tiene que sacar para la mesa 1.
    const cards = groupByTable([
      comanda({ id: 'o1', items: [plato('i1', 'SENT', 'bife')] }),
      comanda({ id: 'o2', items: [plato('i2', 'SENT', 'flan')] }),
    ]);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.items.map((i) => i.name)).toEqual(['bife', 'flan']);
  });

  it('dice cuántas veces pidió, para que se note que agregó después', () => {
    const cards = groupByTable([comanda({ id: 'o1' }), comanda({ id: 'o2' })]);
    expect(cards[0]?.ticketCount).toBe(2);
  });

  it('mantiene separadas las mesas distintas', () => {
    const cards = groupByTable([
      comanda({ tableId: 'mesa-1' }),
      comanda({ tableId: 'mesa-2', sessionId: 's2' }),
    ]);
    expect(cards).toHaveLength(2);
  });

  it('deja cada plato con su comanda, que es lo que hay que avanzar', () => {
    const cards = groupByTable([
      comanda({ id: 'o1', items: [plato('i1', 'SENT')] }),
      comanda({ id: 'o2', items: [plato('i2', 'SENT')] }),
    ]);

    expect(cards[0]?.items.map((i) => i.orderId)).toEqual(['o1', 'o2']);
  });

  it('pone la tarjeta en la columna del plato más atrasado', () => {
    // Con la limonada lista y el vacío sin empezar, la mesa no está lista.
    const cards = groupByTable([
      comanda({
        items: [plato('i1', 'READY', 'limonada', 'BARRA'), plato('i2', 'SENT', 'vacío')],
      }),
    ]);

    expect(cards[0]?.status).toBe('SENT');
  });

  it('cuenta la espera desde el envío más viejo', () => {
    // Es hace cuánto que la mesa espera algo, no cuándo llegó el postre.
    const cards = groupByTable([
      comanda({ id: 'o1', placedAt: '2026-08-15T21:00:00.000Z' }),
      comanda({ id: 'o2', placedAt: '2026-08-15T21:20:00.000Z' }),
    ]);

    expect(cards[0]?.placedAt).toBe('2026-08-15T21:00:00.000Z');
  });

  it('muestra primero a quien espera hace más tiempo', () => {
    const cards = groupByTable([
      comanda({ tableId: 'mesa-9', placedAt: '2026-08-15T21:30:00.000Z' }),
      comanda({ tableId: 'mesa-2', sessionId: 's2', placedAt: '2026-08-15T21:00:00.000Z' }),
    ]);

    expect(cards.map((c) => c.tableId)).toEqual(['mesa-2', 'mesa-9']);
  });

  it('no mezcla sesiones cuando la comanda no dice de qué mesa es', () => {
    // Juntarlas sería peor que no agrupar: serían pedidos de gente distinta.
    const cards = groupByTable([
      comanda({ tableId: null, sessionId: 's1' }),
      comanda({ tableId: null, sessionId: 's2' }),
    ]);

    expect(cards).toHaveLength(2);
  });

  it('no devuelve nada cuando no hay comandas', () => {
    expect(groupByTable([])).toEqual([]);
  });
});

describe('qué se muestra abierto cuando la cocina está llena', () => {
  const mesa = (n: number, minutos: number): TableCard => ({
    key: `mesa-${n}`,
    tableId: `mesa-${n}`,
    status: 'SENT',
    placedAt: `2026-08-15T21:${String(n).padStart(2, '0')}:00.000Z`,
    ticketCount: 1,
    items: [],
    // El tiempo de espera viaja aparte, para no atarlo al reloj del test.
    ...({ minutos } as unknown as object),
  });
  const espera = (card: TableCard): number => (card as unknown as { minutos: number }).minutos;

  it('abre las primeras y pliega el resto', () => {
    // Veinte mesas desplegadas eran ocho pantallas de scroll.
    const mesas = Array.from({ length: 20 }, (_, i) => mesa(i, 1));
    const { open, folded } = splitByUrgency(mesas, espera, 15, 5);

    expect(open).toHaveLength(5);
    expect(folded).toHaveLength(15);
  });

  it('no pliega nada cuando la cocina está tranquila', () => {
    const { open, folded } = splitByUrgency([mesa(1, 2), mesa(2, 3)], espera, 15, 5);
    expect(open).toHaveLength(2);
    expect(folded).toEqual([]);
  });

  it('nunca pliega una mesa que se está enfriando', () => {
    // La mesa 19 llegó última pero espera hace media hora: si se pliega,
    // el cocinero no la ve hasta que alguien reclama.
    const mesas = [
      ...Array.from({ length: 10 }, (_, i) => mesa(i, 1)),
      mesa(19, 30),
    ];
    const { open, folded } = splitByUrgency(mesas, espera, 15, 5);

    expect(open.some((c) => c.tableId === 'mesa-19')).toBe(true);
    expect(folded.some((c) => c.tableId === 'mesa-19')).toBe(false);
  });

  it('mantiene el orden de llegada en lo que abre', () => {
    const mesas = [mesa(1, 9), mesa(2, 8), mesa(3, 7)];
    const { open } = splitByUrgency(mesas, espera, 15, 2);
    expect(open.map((c) => c.tableId)).toEqual(['mesa-1', 'mesa-2']);
  });

  it('aguanta un tablero vacío', () => {
    expect(splitByUrgency([], espera, 15, 5)).toEqual({ open: [], folded: [] });
  });
});

describe('cómo se muestra el tablero según la pantalla', () => {
  it('usa columnas en la tablet de la cocina', () => {
    expect(layoutFor(1280)).toBe('columns');
  });

  it('pasa a pestañas cuando las cuatro columnas ya no entran', () => {
    // Una tablet vertical: cuatro columnas ahí quedan ilegibles.
    expect(layoutFor(820)).toBe('tabs');
  });

  it('usa una sola lista en el teléfono', () => {
    // En columnas, un teléfono apila las cuatro etapas y deja "listo" al
    // final del scroll — justo lo que el cocinero necesita ver primero.
    expect(layoutFor(390)).toBe('list');
  });

  it('cambia justo en el límite, no antes', () => {
    expect(layoutFor(640)).toBe('tabs');
    expect(layoutFor(639)).toBe('list');
    expect(layoutFor(1100)).toBe('columns');
    expect(layoutFor(1099)).toBe('tabs');
  });
});
