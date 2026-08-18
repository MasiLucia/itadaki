import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FloorComponent } from './app/floor.component';

void bootstrapApplication(FloorComponent, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true })],
}).catch((error: unknown) => {
  console.error('bootstrap failed', error);
});

// A reload during an outage must still open the screen; the outbox keeps the
// taps safe either way.
// En desarrollo se saca de encima: el worker instalado al probar un deploy
// comparte origen con el servidor de desarrollo y devuelve pantallas viejas.
const enDesarrollo =
  globalThis.location.hostname === 'localhost' || globalThis.location.hostname === '127.0.0.1';

if ('serviceWorker' in navigator) {
  if (enDesarrollo) {
    void navigator.serviceWorker.getRegistrations().then((registros) => {
      for (const registro of registros) void registro.unregister();
    });
  } else {
    globalThis.addEventListener('load', () => {
      void navigator.serviceWorker.register('sw.js').catch(() => {
        // Without it the screen simply needs a connection to load; not fatal.
      });
    });
  }
}
