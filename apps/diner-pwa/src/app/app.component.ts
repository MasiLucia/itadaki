import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OfflineBannerComponent } from './offline-banner.component';
import { TableBlockedComponent } from './table-blocked.component';
import { ToastComponent } from './toast.component';
import { CallButtonComponent } from './call-button.component';

@Component({
  selector: 'itd-root',
  standalone: true,
  imports: [
    RouterOutlet,
    OfflineBannerComponent,
    TableBlockedComponent,
    ToastComponent,
    CallButtonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <itd-offline-banner />
    <router-outlet />
    <itd-call-button />
    <itd-toast />
    <itd-table-blocked />
  `,
})
export class AppComponent {}
