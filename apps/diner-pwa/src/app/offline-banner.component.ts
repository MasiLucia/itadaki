import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { OfflineStore } from './offline.store';

/**
 * Tells the diner what is actually happening: browsing works offline, and
 * anything they sent is queued rather than lost.
 */
@Component({
  selector: 'itd-offline-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .banner {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.5rem 1rem calc(0.5rem + env(safe-area-inset-top));
      font-size: 0.78rem;
      font-weight: 600;
      color: white;
      background: var(--itadaki-ink);
    }
    .banner.syncing { background: var(--itadaki-status-ready-fg); }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--itadaki-status-cooking);
      flex-shrink: 0;
    }
    .banner.syncing .dot {
      background: white;
      animation: itadaki-pulse-dot 1.4s ease-in-out infinite;
    }
  `],
  template: `
    @if (!offline.online()) {
      <div class="banner" role="status">
        <span class="dot" aria-hidden="true"></span>
        sin conexión · podés seguir armando el pedido
        @if (offline.pending() > 0) {
          · {{ offline.pending() }} en espera
        }
      </div>
    } @else if (offline.pending() > 0) {
      <div class="banner syncing" role="status">
        <span class="dot" aria-hidden="true"></span>
        enviando {{ offline.pending() }} pedido{{ offline.pending() > 1 ? 's' : '' }}…
      </div>
    }
  `,
})
export class OfflineBannerComponent {
  protected readonly offline = inject(OfflineStore);
}
