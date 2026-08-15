import { blockFrom } from './table-block';

describe('reading a failure the diner cannot retry past', () => {
  it('recognises an expired QR', () => {
    expect(blockFrom({ status: 401, kind: 'INVALID_TABLE_TOKEN' })).toBe('EXPIRED_TOKEN');
  });

  it('recognises a settled table, which still answers 200', () => {
    // The session stays readable after the bill is paid — it just reports
    // CLOSED. Reading only the status code would miss this entirely.
    expect(blockFrom({ status: 200, sessionStatus: 'CLOSED' })).toBe('SESSION_CLOSED');
  });

  it('recognises a session that is gone altogether', () => {
    expect(blockFrom({ status: 404, kind: 'NOT_FOUND', aboutSession: true })).toBe(
      'SESSION_CLOSED',
    );
  });

  it('does not end the meal because no bill exists yet', () => {
    // Opening the bill screen asks for a bill that has not been raised. This
    // threw the diner out of their own order.
    expect(blockFrom({ status: 404, kind: 'NOT_FOUND', aboutSession: false })).toBeNull();
  });

  it('does not end the meal over any other missing resource', () => {
    // A call, an order, a dish — none of them speak for the table.
    expect(blockFrom({ status: 404, kind: 'NOT_FOUND' })).toBeNull();
  });

  it('leaves an open table alone', () => {
    expect(blockFrom({ status: 200, sessionStatus: 'OPEN' })).toBeNull();
  });

  it('leaves a wrong-table refusal alone', () => {
    // Scoped to someone else's table: a bug or tampering, not a dead session.
    expect(blockFrom({ status: 403, kind: 'WRONG_TABLE' })).toBeNull();
  });

  it('leaves a rate limit alone — retrying later works', () => {
    expect(blockFrom({ status: 429, kind: 'TOO_MANY_REQUESTS' })).toBeNull();
  });

  it('leaves a server error alone', () => {
    expect(blockFrom({ status: 500, kind: 'INTERNAL_ERROR' })).toBeNull();
  });

  it('leaves a missing dish alone', () => {
    // A 404 without the NOT_FOUND kind is some other resource, not the table.
    expect(blockFrom({ status: 404 })).toBeNull();
  });

  it('does not treat a sold-out dish as the end of the meal', () => {
    expect(blockFrom({ status: 409, kind: 'PRODUCT_UNAVAILABLE' })).toBeNull();
  });
});

describe('cuando otro de la mesa cerró la cuenta', () => {
  it('termina la comida para todos, no sólo para quien cerró', () => {
    // El teléfono del otro comensal no se enteró: seguía eligiendo platos.
    // Sin esto vería un error suelto sobre una carta que parece viva.
    expect(blockFrom({ kind: 'SESSION_CLOSED', status: 409 })).toBe('SESSION_CLOSED');
  });

  it('no confunde un plato que se acabó con la mesa cerrada', () => {
    expect(blockFrom({ kind: 'PRODUCT_UNAVAILABLE', status: 409 })).toBeNull();
  });
});
