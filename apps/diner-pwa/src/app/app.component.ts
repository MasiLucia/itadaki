import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { OfflineBannerComponent } from './offline-banner.component';
import { TableBlockedComponent } from './table-blocked.component';
import { ToastComponent } from './toast.component';
import { CallButtonComponent } from './call-button.component';
import { InviteSheetComponent } from './invite-sheet.component';
import { SessionStore } from './session.store';

@Component({
  selector: 'itd-root',
  standalone: true,
  imports: [
    RouterOutlet,
    OfflineBannerComponent,
    TableBlockedComponent,
    ToastComponent,
    CallButtonComponent,
    InviteSheetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <itd-offline-banner />
    <router-outlet />
    <itd-call-button />
    @if (session.inviting()) {
      <itd-invite-sheet />
    }
    <itd-toast />
    <itd-table-blocked />
  `,
})
export class AppComponent {
  protected readonly session = inject(SessionStore);
}
