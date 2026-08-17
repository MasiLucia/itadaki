import { DEFAULT_CATEGORY, csvToMenuText, htmlToMenuText, parseMenuText } from './menu-import';

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

describe('subir la carta como planilla', () => {
  /** Lo que importa es el resultado final, no el texto intermedio. */
  const importar = (csv: string) => parseMenuText(csvToMenuText(csv));

  it('lee una planilla con encabezados', () => {
    const csv = ['nombre,precio,categoria', 'Empanadas,3400,Entradas'].join('\n');
    const { dishes } = importar(csv);

    expect(dishes).toHaveLength(1);
    expect(dishes[0]?.name).toBe('Empanadas');
    expect(dishes[0]?.priceMinor).toBe(340_000);
    expect(dishes[0]?.category).toBe('Entradas');
  });

  it('no exige un orden de columnas', () => {
    // Cada planilla las pone donde quiere; buscarlas por nombre evita pedirle
    // a alguien que reordene su Excel antes de subirlo.
    const csv = ['Categoria,Precio,Plato', 'Parrilla,8500,Bife de chorizo'].join('\n');
    const { dishes } = importar(csv);

    expect(dishes[0]?.name).toBe('Bife de chorizo');
    expect(dishes[0]?.category).toBe('Parrilla');
  });

  it('reconoce los encabezados con tildes y mayúsculas', () => {
    const csv = ['NOMBRE;PRECIO;CATEGORÍA', 'Flan;2600;Postres'].join('\n');
    expect(importar(csv).dishes[0]?.category).toBe('Postres');
  });

  it('acepta punto y coma, que es como exporta Excel en español', () => {
    const csv = ['nombre;precio', 'Provoleta;5200'].join('\n');
    expect(importar(csv).dishes[0]?.priceMinor).toBe(520_000);
  });

  it('respeta las comas dentro de comillas', () => {
    // "milanesa, papas y ensalada" viene entrecomillado justamente para que
    // no se lea como tres columnas.
    const csv = ['nombre,descripcion,precio', 'Milanesa,"con papas, ensalada",8500'].join('\n');
    const { dishes } = importar(csv);

    expect(dishes[0]?.name).toBe('Milanesa');
    expect(dishes[0]?.description).toBe('con papas, ensalada');
  });

  it('asume nombre, precio y categoría cuando no hay encabezados', () => {
    const csv = ['Empanadas,3400,Entradas', 'Bife,8500,Parrilla'].join('\n');
    const { dishes, categories } = importar(csv);

    expect(dishes).toHaveLength(2);
    expect(categories).toEqual(['Entradas', 'Parrilla']);
  });

  it('agrupa los platos de la misma sección sin repetirla', () => {
    const csv = [
      'nombre,precio,categoria',
      'Empanadas,3400,Entradas',
      'Provoleta,5200,Entradas',
      'Bife,8500,Parrilla',
    ].join('\n');
    const { dishes, categories } = importar(csv);

    expect(categories).toEqual(['Entradas', 'Parrilla']);
    expect(dishes.map((d) => d.category)).toEqual(['Entradas', 'Entradas', 'Parrilla']);
  });

  it('lee los precios escritos como los escribe una planilla', () => {
    const csv = ['nombre,precio', 'Uno,$8.500', 'Dos,8500', 'Tres,"8.500"'].join('\n');
    const precios = importar(csv).dishes.map((d) => d.priceMinor);

    expect(precios).toEqual([850_000, 850_000, 850_000]);
  });

  it('ignora las filas vacías que deja un Excel al final', () => {
    const csv = ['nombre,precio', 'Flan,2600', ',', '', ';'].join('\n');
    expect(importar(csv).dishes).toHaveLength(1);
  });

  it('no devuelve nada con una planilla vacía', () => {
    expect(csvToMenuText('')).toBe('');
    expect(importar('').dishes).toEqual([]);
  });

  it('deja sin sección lo que la planilla no clasifica', () => {
    const csv = ['nombre,precio', 'Flan,2600'].join('\n');
    expect(importar(csv).dishes[0]?.category).toBe(DEFAULT_CATEGORY);
  });
});

describe('leer una carta publicada en una página', () => {
  const importar = (html: string) => parseMenuText(htmlToMenuText(html));

  it('deja el plato y su precio en el mismo renglón aunque estén en spans distintos', () => {
    const { dishes } = importar(
      '<li><span class="n">Milanesa napolitana</span><span class="p">$8.500</span></li>',
    );

    expect(dishes).toHaveLength(1);
    expect(dishes[0]?.name).toBe('Milanesa napolitana');
    expect(dishes[0]?.priceMinor).toBe(850_000);
  });

  it('corta el renglón donde la página lo corta', () => {
    const { dishes, categories } = importar(
      '<h2>ENTRADAS</h2><div>Empanadas 3400</div><div>Provoleta<br>5200</div>',
    );

    expect(categories).toEqual(['ENTRADAS', 'Provoleta']);
    expect(dishes.map((d) => d.name)).toEqual(['Empanadas']);
  });

  it('tira el script y el estilo, que no son la carta', () => {
    const texto = htmlToMenuText(
      '<style>.p{color:red}</style><script>var precio = 9999;</script><p>Flan 2600</p>',
    );

    expect(texto).toBe('Flan 2600');
  });

  it('devuelve los acentos y el símbolo escritos como entidades', () => {
    const texto = htmlToMenuText('<p>Milanesa a caballo&nbsp;&mdash;&nbsp;$8.500</p><p>Pur&eacute;</p>');

    expect(texto).toBe('Milanesa a caballo — $8.500\nPuré');
  });

  it('no devuelve nada de una página que arma la carta con JavaScript', () => {
    expect(htmlToMenuText('<div id="menu"></div><script>render()</script>')).toBe('');
  });
});
