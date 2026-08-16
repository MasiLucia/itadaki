import { goBack, type HistoryLike, type RouterLike } from './back';

/**
 * El botón "volver" de la app y el del navegador tienen que hacer lo mismo.
 * Con un `routerLink` fijo no lo hacían: volver apilaba una entrada, y el
 * atrás del navegador devolvía a la pantalla que el usuario acababa de dejar.
 */

const historyWith = (state: unknown) => {
  const calls = { back: 0 };
  const history: HistoryLike = {
    getState: () => state,
    back: () => {
      calls.back += 1;
    },
  };
  return { history, calls };
};

const routerSpy = () => {
  const visited: string[] = [];
  const router: RouterLike = {
    navigateByUrl: (url: string) => {
      visited.push(url);
      return true;
    },
  };
  return { router, visited };
};

describe('goBack', () => {
  it('retrocede en el historial cuando hay una pantalla propia atrás', () => {
    const { history, calls } = historyWith({ navigationId: 3 });
    const { router, visited } = routerSpy();

    goBack(history, router, '/carta');

    expect(calls.back).toBe(1);
    // Nada de navegar: apilaría una entrada y duplicaría el recorrido.
    expect(visited).toEqual([]);
  });

  it('navega al padre cuando la app abrió directo en esta pantalla', () => {
    const { history, calls } = historyWith({ navigationId: 1 });
    const { router, visited } = routerSpy();

    goBack(history, router, '/carta');

    // Retroceder acá sacaría al usuario de la app, que entró por el QR.
    expect(calls.back).toBe(0);
    expect(visited).toEqual(['/carta']);
  });

  it('trata el historial sin estado como primera pantalla', () => {
    const { history, calls } = historyWith(null);
    const { router, visited } = routerSpy();

    goBack(history, router, '/carta');

    expect(calls.back).toBe(0);
    expect(visited).toEqual(['/carta']);
  });
});
