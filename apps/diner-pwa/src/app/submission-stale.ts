/**
 * Si el aviso del envío anterior ya no corresponde.
 *
 * "Pedido enviado · seguir mi pedido" ocupa el lugar del botón de enviar, y
 * sólo se soltaba cuando alguien tocaba ese link. Quien volvía a la carta,
 * agregaba un plato y volvía al carrito se encontraba con el aviso del envío
 * anterior y sin forma de mandar lo nuevo.
 *
 * Que el carrito se haya vaciado en el medio es lo que distingue un plato
 * nuevo de los que se acaban de mandar: el servidor vacía el carrito
 * compartido al crear la comanda, así que lo que aparece después es otra cosa.
 */
export function submissionIsStale(
  kind: string,
  pendingLines: number,
  emptiedSinceSend: boolean,
): boolean {
  return (kind === 'sent' || kind === 'queued') && emptiedSinceSend && pendingLines > 0;
}
