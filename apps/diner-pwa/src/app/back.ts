/**
 * Volver una pantalla sin pelearse con el historial.
 *
 * Suelto, en su propio archivo: lo usan el botón de texto de las cabeceras y
 * el botón redondo sobre la foto de un plato, que comparten la decisión y no
 * el dibujo. Además así se puede probar sin levantar Angular.
 */

/** Lo mínimo de `Location` y `Router` que hace falta acá. */
export interface HistoryLike {
  getState(): unknown;
  back(): void;
}

export interface RouterLike {
  navigateByUrl(url: string): unknown;
}

/**
 * Retrocede si hay historial propio; si no, va a la pantalla padre.
 *
 * El Router numera cada navegación que hizo él en `history.state`. Más de una
 * significa que hay una pantalla de la app atrás, y `back()` deja el historial
 * exactamente como lo dejaría el botón del navegador. Con una sola —alguien
 * que abrió la app escaneando el QR y cayó directo acá— `back()` sacaría al
 * usuario de la aplicación, así que ahí sí se navega.
 *
 * Nunca un `routerLink` fijo: apila una entrada nueva, y entonces tocar
 * "volver" y después atrás del navegador devolvía a la pantalla recién dejada.
 */
export function goBack(history: HistoryLike, router: RouterLike, fallback: string): void {
  const state = history.getState() as { navigationId?: number } | null;
  if ((state?.navigationId ?? 1) > 1) {
    history.back();
    return;
  }

  void router.navigateByUrl(fallback);
}
