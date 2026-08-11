import { provideZoneChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AdminComponent } from './app/admin.component';

void bootstrapApplication(AdminComponent, {
  providers: [provideZoneChangeDetection({ eventCoalescing: true })],
}).catch((error: unknown) => {
  console.error('bootstrap failed', error);
});
