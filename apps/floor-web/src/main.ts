import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { FloorComponent } from './app/floor.component';

void bootstrapApplication(FloorComponent, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true })],
}).catch((error: unknown) => {
  console.error('bootstrap failed', error);
});
