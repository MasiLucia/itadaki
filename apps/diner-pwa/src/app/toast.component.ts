import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastStore } from './toast.store';

/** The confirmation the design calls for after adding a dish. */
@Component({
  selector: 'itd-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(5.5rem + env(safe-area-inset-bottom));
      z-index: 60;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 0.45rem;
      padding: 0.7rem 1.1rem;
      border-radius: var(--itadaki-radius-pill);
      background: var(--itadaki-ink);
      color: white;
      font-family: var(--itadaki-font-display);
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: var(--itadaki-shadow-raised);
      white-space: nowrap;
      max-width: calc(100vw - 2rem);
      overflow: hidden;
      text-overflow: ellipsis;
      animation: itadaki-toast-in 2.4s ease forwards;
    }
    .tick {
      display: grid;
      place-items: center;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      border-radius: 50%;
      background: var(--itadaki-status-ready);
      font-size: 0.62rem;
      color: var(--itadaki-ink);
    }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: none; }
    }
  `],
  template: `
    @if (toast.message(); as message) {
      <!-- role=status, not alert: a confirmation should not interrupt whatever
           a screen reader is already saying. -->
      <div class="toast" role="status">
        <span class="tick" aria-hidden="true">✓</span>
        {{ message }}
      </div>
    }
  `,
})
export class ToastComponent {
  protected readonly toast = inject(ToastStore);
}
