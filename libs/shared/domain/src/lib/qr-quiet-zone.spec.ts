import { QR_QUIET_ZONE, encodeQr, isQrError, qrToSvgPath, qrViewBox } from './qr';

/**
 * Sin la zona de silencio el QR no se detecta, aunque esté perfectamente
 * dibujado: el lector busca los tres cuadrados de las esquinas contra un fondo
 * claro, y pegados al borde del recuadro no los encuentra. Pasó de verdad —
 * la cámara no reconocía nada frente a un código impecable.
 */

const link = (largo: number): string => 'https://itadaki.app/unirse?t=' + 'a'.repeat(largo);

describe('qrViewBox', () => {
  it('deja cuatro módulos de margen a cada lado', () => {
    const matrix = encodeQr(link(160));
    if (isQrError(matrix)) throw new Error('la fixture tiene que codificar');

    const total = matrix.size + QR_QUIET_ZONE * 2;
    expect(qrViewBox(matrix)).toBe(`-4 -4 ${total} ${total}`);
  });

  it('el margen crece con el código, no queda fijo', () => {
    const corto = encodeQr(link(20));
    const largo = encodeQr(link(300));
    if (isQrError(corto) || isQrError(largo)) throw new Error('las fixtures tienen que codificar');

    // Una matriz más densa ocupa más módulos; el margen sigue siendo cuatro de
    // ellos, que es lo que lo mantiene proporcional al tamaño dibujado.
    expect(largo.size).toBeGreaterThan(corto.size);
    expect(qrViewBox(corto).startsWith('-4 -4 ')).toBe(true);
    expect(qrViewBox(largo).startsWith('-4 -4 ')).toBe(true);
  });

  it('los módulos siguen empezando en el origen', () => {
    const matrix = encodeQr(link(160));
    if (isQrError(matrix)) throw new Error('la fixture tiene que codificar');

    // El path no se corre: el margen sale de agrandar el viewBox hacia atrás,
    // así que el primer módulo dibujado sigue en 0,0.
    expect(qrToSvgPath(matrix).startsWith('M0 0h1v1h-1z')).toBe(true);
  });
});
