import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { KdsComponent } from './app/kds.component';

void bootstrapApplication(KdsComponent, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true })],
}).catch((error: unknown) => {
  console.error('bootstrap failed', error);
});

// A reload during an outage must still open the screen; the outbox keeps the
// taps safe either way.
if ('serviceWorker' in navigator) {
  globalThis.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => {
      // Without it the screen simply needs a connection to load; not fatal.
    });
  });
}
