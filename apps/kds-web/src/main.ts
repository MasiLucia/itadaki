import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { KdsComponent } from './app/kds.component';

void bootstrapApplication(KdsComponent, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true })],
}).catch((error: unknown) => {
  console.error('bootstrap failed', error);
});
