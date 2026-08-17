import { submissionIsStale } from './submission-stale';

/**
 * El caso que lo motivó: mandar el pedido, volver a la carta, agregar un plato
 * y encontrarse en el carrito con el aviso del envío anterior en el lugar del
 * botón — sin forma de mandar lo nuevo.
 */
describe('cuándo caduca el aviso del envío anterior', () => {
  it('caduca cuando la mesa carga algo después de que el carrito se vació', () => {
    expect(submissionIsStale('sent', 1, true)).toBe(true);
  });

  it('también con el pedido en cola, esperando señal', () => {
    expect(submissionIsStale('queued', 2, true)).toBe(true);
  });

  it('sigue valiendo mientras no haya nada nuevo que enviar', () => {
    expect(submissionIsStale('sent', 0, true)).toBe(false);
  });

  /**
   * El servidor vacía el carrito compartido al crear la comanda, y ese vaciado
   * llega por el socket. Hasta que llega, las líneas en pantalla son las que
   * se acaban de mandar: tomarlas por nuevas devolvería el botón de enviar y
   * la mesa podría mandar dos veces lo mismo.
   */
  it('no caduca por las líneas que se acaban de enviar', () => {
    expect(submissionIsStale('sent', 3, false)).toBe(false);
  });

  it('no aplica cuando no hay ningún envío que avisar', () => {
    expect(submissionIsStale('idle', 2, true)).toBe(false);
    expect(submissionIsStale('sending', 2, true)).toBe(false);
    expect(submissionIsStale('failed', 2, true)).toBe(false);
  });
});
