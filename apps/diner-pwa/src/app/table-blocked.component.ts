import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiClient } from './api-client';
import { SessionStore } from './session.store';

/**
 * Covers the screen when the table stops being usable.
 *
 * A full takeover rather than a banner: both cases are terminal, and leaving
 * the cart tappable underneath invites someone to keep ordering into a table
 * that will reject every request.
 */
@Component({
  selector: 'itd-table-blocked',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .screen {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      padding: 2rem 1.75rem calc(2rem + env(safe-area-inset-bottom));
      text-align: center;
      background: var(--itadaki-surface);
    }
    .mark {
      font-size: 2.4rem;
      line-height: 1;
      margin-bottom: 0.2rem;
    }
    .title {
      font-family: var(--itadaki-font-display);
      font-weight: 800;
      font-size: 1.35rem;
      color: var(--itadaki-ink-strong);
      margin: 0;
      letter-spacing: -0.4px;
    }
    .cta {
      margin-top: 0.9rem;
      border: none;
      border-radius: var(--itadaki-radius-pill);
      background: var(--itadaki-ink);
      color: white;
      padding: 0.9rem 1.6rem;
      font-family: var(--itadaki-font-display);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      min-height: 48px;
    }
    .lede {
      font-size: 0.9rem;
      color: var(--itadaki-ink-subtle);
      margin: 0;
      max-width: 30ch;
      line-height: 1.5;
    }
  `],
  template: `
    @if (api.blocked(); as reason) {
      <div class="screen" role="alert">
        @if (reason === 'SESSION_CLOSED') {
          <span class="mark" aria-hidden="true">🍽️</span>
          <h1 class="title">gochisousama!</h1>
          <p class="lede">
            La cuenta de esta mesa ya se cerró. Gracias por venir.
          </p>
          <button type="button" class="cta" (click)="startOver()">
            empezar de nuevo
          </button>
        } @else {
          <span class="mark" aria-hidden="true">📷</span>
          <h1 class="title">escaneá de nuevo</h1>
          <p class="lede">
            El código de tu mesa venció. Escaneá el QR otra vez para seguir
            pidiendo — no perdés nada de lo que ya enviaste.
          </p>
          <button type="button" class="cta" (click)="startOver()">
            volver al inicio
          </button>
        }
      </div>
    }
  `,
})
export class TableBlockedComponent {
  protected readonly api = inject(ApiClient);
  private readonly session = inject(SessionStore);
  private readonly router = inject(Router);

  /**
   * Clears the finished table and goes back to the start.
   *
   * Without this the screen is a dead end: the stored session keeps restoring
   * on every reload, and the only escape is clearing site data by hand.
   */
  protected startOver(): void {
    this.session.forget();
    void this.router.navigate(['/bienvenida']);
  }
}
