import { apiUrl, socketUrl } from '@itadaki/shared/domain';
import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import {
  API_BASE_URL,
  CATEGORY_READER,
  MODIFIER_GROUPS_TOKEN,
  PRODUCT_READER,
  TENANT,
  WS_URL,
} from './app/catalog.tokens';
import { HttpCatalog, HttpCategoryReader } from './app/http-catalog';
import { OfflineStore } from './app/offline.store';
// Imported for its module side effect: it grabs `?t=` from the URL before the
// router redirects '' to bienvenida and drops the query string.
import './app/table-token.store';

const API_URL = apiUrl();
// Tenant is app configuration, not server infrastructure: importing it from
// catalog/infra would drag sharp and node builtins into the browser bundle.
const TENANT_ID = 'itadaki';

/**
 * Composition root: the only place that knows the catalog comes over HTTP.
 * Screens depend on ProductReader/CategoryReader alone.
 */
void bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    { provide: API_BASE_URL, useValue: API_URL },
    { provide: WS_URL, useValue: socketUrl() },
    {
      provide: PRODUCT_READER,
      useFactory: (offline: OfflineStore) => new HttpCatalog(API_URL, offline),
      deps: [OfflineStore],
    },
    {
      provide: CATEGORY_READER,
      useFactory: (reader: HttpCatalog) => new HttpCategoryReader(reader),
      deps: [PRODUCT_READER],
    },
    {
      provide: MODIFIER_GROUPS_TOKEN,
      useFactory: (reader: HttpCatalog) => () => reader.modifierGroups(),
      deps: [PRODUCT_READER],
    },
    { provide: TENANT, useValue: TENANT_ID },
  ],
}).catch((error: unknown) => {
  console.error('bootstrap failed', error);
});

if ('serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support degrades to the IndexedDB cache; not fatal.
    });
  });
}
