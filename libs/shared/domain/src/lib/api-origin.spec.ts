import { type PageContext, apiOrigin, apiUrl, socketUrl } from './api-origin';

const page = (overrides: Partial<PageContext> = {}): PageContext => ({
  configured: null,
  protocol: 'https:',
  hostname: 'pedi.itadaki.ar',
  origin: 'https://pedi.itadaki.ar',
  ...overrides,
});

describe('where the browser apps find the API', () => {
  it('uses the origin the deploy configured', () => {
    expect(apiOrigin(page({ configured: 'https://api.itadaki.ar' }))).toBe(
      'https://api.itadaki.ar',
    );
  });

  it('trims a trailing slash so the path never doubles up', () => {
    expect(apiUrl(page({ configured: 'https://api.itadaki.ar/' }))).toBe(
      'https://api.itadaki.ar/api',
    );
  });

  it('ignores a placeholder the deploy forgot to substitute', () => {
    // Better to fall back than to resolve a literal "__API_ORIGIN__" host.
    expect(apiOrigin(page({ configured: '__API_ORIGIN__' }))).toBe('https://pedi.itadaki.ar');
  });

  it('ignores an empty or blank tag', () => {
    expect(apiOrigin(page({ configured: '' }))).toBe('https://pedi.itadaki.ar');
    expect(apiOrigin(page({ configured: '   ' }))).toBe('https://pedi.itadaki.ar');
  });

  it('falls back to the page origin when the API shares the domain', () => {
    expect(apiUrl(page())).toBe('https://pedi.itadaki.ar/api');
  });

  it('points at the API dev server when running locally', () => {
    // Each app has its own dev port, so "same origin" would be wrong here.
    const local = page({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:4200' });
    expect(apiOrigin(local)).toBe('http://localhost:3000');
  });

  it('treats 127.0.0.1 as local too', () => {
    const local = page({ protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:4200' });
    expect(apiOrigin(local)).toBe('http://127.0.0.1:3000');
  });

  it('serves REST under /api and the socket at the bare origin', () => {
    const configured = page({ configured: 'https://api.itadaki.ar' });
    expect(apiUrl(configured)).toBe('https://api.itadaki.ar/api');
    expect(socketUrl(configured)).toBe('https://api.itadaki.ar');
  });
});
