import { isPrivateAddress } from './fetch-page';

/**
 * La lista de lo que no se puede pedir.
 *
 * Es lo único que separa "traer la carta de una web" de "pedirle al servidor
 * que lea la red interna del proveedor", así que se prueba nombre por nombre
 * en vez de confiar en que el regex diga lo que parece decir.
 */
describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', 'la propia máquina'],
    ['0.0.0.0', 'sin especificar, que también es local'],
    ['10.1.2.3', 'red privada'],
    ['172.16.0.1', 'red privada'],
    ['172.31.255.254', 'red privada, último'],
    ['192.168.1.1', 'red privada'],
    ['169.254.169.254', 'los metadatos de la nube, con sus credenciales'],
    ['100.64.0.1', 'CGNAT, comparte vecinos'],
    ['198.18.0.1', 'pruebas de red'],
    ['224.0.0.1', 'multicast'],
    ['::1', 'la propia máquina en IPv6'],
    ['fd00::1', 'única local'],
    ['fe80::1', 'link-local'],
    ['::ffff:127.0.0.1', 'la propia máquina escrita como IPv6'],
    ['::ffff:10.0.0.1', 'red privada escrita como IPv6'],
    ['no-es-una-ip', 'lo que no se entiende no se permite'],
  ])('rechaza %s (%s)', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ['8.8.8.8'],
    ['1.1.1.1'],
    ['172.15.0.1'],
    ['172.32.0.1'],
    ['192.169.0.1'],
    ['100.63.255.255'],
    ['2800:3f0:4000::1'],
  ])('permite %s', (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});
