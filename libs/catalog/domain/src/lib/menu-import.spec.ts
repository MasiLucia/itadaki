import { DEFAULT_CATEGORY, parseMenuText } from './menu-import';

describe('leer una carta pegada de otro lado', () => {
  it('lee un plato con su precio', () => {
    const { dishes } = parseMenuText('Milanesa napolitana 8500');

    expect(dishes).toHaveLength(1);
    expect(dishes[0]?.name).toBe('Milanesa napolitana');
    expect(dishes[0]?.priceMinor).toBe(850_000);
  });

  it('entiende el punto como separador de miles', () => {
    // En Argentina "8.500" son ocho mil quinientos. Leerlo como 8,50 cobraría
    // mil veces menos, que es peor que no importar nada.
    expect(parseMenuText('Bife de chorizo $8.500').dishes[0]?.priceMinor).toBe(850_000);
  });

  it('acepta los centavos cuando la carta los escribe', () => {
    expect(parseMenuText('Café 1.250,50').dishes[0]?.priceMinor).toBe(125_050);
  });

  it('tolera las formas en que se escribe un precio', () => {
    const carta = ['Uno $4500', 'Dos 4.500', 'Tres $ 4.500.-', 'Cuatro 4500-'].join('\n');
    const precios = parseMenuText(carta).dishes.map((d) => d.priceMinor);

    expect(precios).toEqual([450_000, 450_000, 450_000, 450_000]);
  });

  it('toma una línea sin precio como el nombre de la sección', () => {
    // Así se ve "ENTRADAS" en cualquier carta: sola, sin número al lado.
    const carta = ['ENTRADAS', 'Empanadas 3400', 'PARRILLA', 'Vacío 9200'].join('\n');
    const { dishes, categories } = parseMenuText(carta);

    expect(categories).toEqual(['ENTRADAS', 'PARRILLA']);
    expect(dishes.map((d) => d.category)).toEqual(['ENTRADAS', 'PARRILLA']);
  });

  it('pone bajo una categoría por defecto lo que llega sin sección', () => {
    expect(parseMenuText('Flan 2600').dishes[0]?.category).toBe(DEFAULT_CATEGORY);
  });

  it('separa el nombre de lo que lo explica', () => {
    const { dishes } = parseMenuText('Milanesa napolitana - con papas fritas 8500');

    expect(dishes[0]?.name).toBe('Milanesa napolitana');
    expect(dishes[0]?.description).toBe('con papas fritas');
  });

  it('también con dos puntos, que es la otra forma de escribirlo', () => {
    const { dishes } = parseMenuText('Provoleta : con orégano y aceite 5200');
    expect(dishes[0]?.name).toBe('Provoleta');
    expect(dishes[0]?.description).toBe('con orégano y aceite');
  });

  it('limpia los puntos que llevan hasta el precio', () => {
    // "Milanesa .......... 8500" es como se alinea una carta impresa.
    const { dishes } = parseMenuText('Milanesa .......... 8500');
    expect(dishes[0]?.name).toBe('Milanesa');
  });

  it('ignora líneas vacías y separadores decorativos', () => {
    const carta = ['ENTRADAS', '———————', '', 'Empanadas 3400', '***'].join('\n');
    const { dishes, skipped } = parseMenuText(carta);

    expect(dishes).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  it('devuelve marcada la línea que no pudo leer', () => {
    // Descubrirlo con la carta ya publicada es peor que corregirlo antes.
    const { skipped } = parseMenuText('8500');

    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.problem).toBe('SIN_NOMBRE');
    expect(skipped[0]?.lineNumber).toBe(1);
  });

  it('señala en qué línea estaba el problema', () => {
    const carta = ['ENTRADAS', 'Empanadas 3400', '9999'].join('\n');
    expect(parseMenuText(carta).skipped[0]?.lineNumber).toBe(3);
  });

  it('sigue leyendo el resto después de una línea rota', () => {
    const carta = ['Empanadas 3400', '8500', 'Flan 2600'].join('\n');
    const { dishes, skipped } = parseMenuText(carta);

    expect(dishes.map((d) => d.name)).toEqual(['Empanadas', 'Flan']);
    expect(skipped).toHaveLength(1);
  });

  it('lee una carta entera como la pegaría un restaurante', () => {
    const carta = [
      'ENTRADAS',
      'Empanadas de carne - media docena $3.400',
      'Provoleta 5.200',
      '',
      'PARRILLA',
      'Bife de chorizo .......... $8.500',
      'Vacío al horno de barro $9.200',
      '',
      'POSTRES',
      'Flan casero con dulce 2.600',
    ].join('\n');

    const { dishes, categories, skipped } = parseMenuText(carta);

    expect(categories).toEqual(['ENTRADAS', 'PARRILLA', 'POSTRES']);
    expect(dishes).toHaveLength(5);
    expect(skipped).toEqual([]);
    expect(dishes[0]?.description).toBe('media docena');
    expect(dishes[3]?.category).toBe('PARRILLA');
    expect(dishes[4]?.priceMinor).toBe(260_000);
  });

  it('no devuelve nada con texto vacío', () => {
    const { dishes, categories, skipped } = parseMenuText('   \n\n  ');

    expect(dishes).toEqual([]);
    expect(categories).toEqual([]);
    expect(skipped).toEqual([]);
  });

  it('no confunde un número dentro del nombre con el precio', () => {
    // El precio es el que cierra la línea, no cualquier número que aparezca.
    const { dishes } = parseMenuText('Pizza 4 quesos 7800');

    expect(dishes[0]?.name).toBe('Pizza 4 quesos');
    expect(dishes[0]?.priceMinor).toBe(780_000);
  });
});
