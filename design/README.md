# Referencia de diseño — ITADAKI

Fuente: proyecto Claude Design `9c542ad1-77c0-4a24-bdb4-f719dabf7210`,
archivo `ITADAKI.dc.html`. Leído vía `DesignSync.get_file`.

El prototipo es un mockup interactivo en un DSL propio (`<sc-for>`, `<sc-if>`,
`DCLogic`). No es código de producción — se traduce a Angular, no se copia.
Los tokens extraídos viven en `libs/shared/ui-tokens/`.

## Identidad

- **Wordmark**: ITADAKI, letra por letra con animación `wiggle` escalonada (0.09s por letra).
- **Tipografía display**: Unbounded (400–800). Títulos, precios, botones, wordmark.
- **Tipografía cuerpo**: Onest (400–800). Descripciones, labels, inputs.
- **Tono de voz**: todo en minúsculas, español rioplatense. "escaneá", "armá tu pedido",
  "itadakimasu!", "gochisousama!". Mantener ese registro en la UI real.

## Paleta

Autoría en `oklch`. El acento terracota (`50% 0.17 33`) marca precio, estado activo
y CTA primario. La tinta (`24% 0.02 40`) es un negro cálido, no `#000`. El fondo es
crema (`96.5% 0.02 80`), nunca blanco puro — el blanco queda para tarjetas elevadas.

Estados KDS: nuevo = terracota, en cocina = ámbar, listo = verde.

## Pantallas del comensal (6)

1. **bienvenida** — bowl con vapor animado, "mesa 07", CTA "ver la carta →"
2. **carta** — chips de categoría con scroll horizontal, tarjetas de producto con
   thumbnail 64×64, barra inferior fija con contador y total del carrito
3. **producto** — hero 180px, precio, descripción, extras seleccionables con borde
   terracota al activarse, stepper de cantidad + CTA "agregar", toast de confirmación
4. **carrito** — líneas con cantidad/nombre/nota, input de nota para cocina,
   subtotal + total, CTA "enviar pedido a cocina →"
5. **estado** — timeline vertical de 4 pasos con dot pulsante en el activo,
   ETA en tarjeta inferior
6. **cuenta** — desglose, total ARS, stepper "dividir entre N personas",
   monto por persona, CTA "pagar en caja"

## Panel admin (KDS)

Panel oscuro (`ink`) sobre el fondo crema. Tres columnas: nuevo / en cocina / listo.
Cada ticket es una tarjeta crema con mesa, tiempo transcurrido, ítems, nota en itálica
terracota, y un botón que lo avanza de columna. Indicador "actualizando en vivo" con
dot verde pulsante.

## Notas de implementación

- **Imágenes**: el mockup usa placeholders a rayas (`repeating-linear-gradient`).
  En producción van `ImageSet` reales con `srcset` + LQIP.
- **Grid del KDS**: `repeat(3, 1fr)` fijo. En la implementación real debe colapsar
  a scroll vertical por columna en tablet, y a una sola columna en teléfono.
- **Motion**: todas las animaciones del prototipo son decorativas. `tokens.css`
  las anula bajo `prefers-reduced-motion`.
- **Contraste**: `ink-disabled` (`65% 0.02 40`) sobre crema queda por debajo de
  WCAG AA para texto chico. Revisar antes de usarlo en labels de pasos inactivos.
