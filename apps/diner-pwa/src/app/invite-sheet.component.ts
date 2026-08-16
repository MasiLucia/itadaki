import { encodeQr, isQrError, qrToSvgPath } from '@itadaki/shared/domain';
import {
  ChangeDetectionStrategy,
  Component,
  type OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { SessionStore } from './session.store';

/**
 * Sumar a los que llegan tarde, sin decir el PIN en voz alta.
 *
 * El PIN lo da el mozo al sentar la mesa y no vuelve a aparecer en ningún
 * teléfono: mostrarlo para que un amigo lo copie es mostrárselo también a
 * quien mire desde la mesa de al lado.
 *
 * El mismo QR sirve para todos los que lleguen mientras esté vigente. Un
 * código por invitado sonaba más seguro, pero en un cumpleaños de veinte
 * obligaba a generar diecinueve, y una función que nadie usa no protege nada.
 */
@Component({
  selector: 'itd-invite-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="close()"></div>
    <div class="sheet" role="dialog" aria-label="Invitar a alguien a la mesa">
      @if (qr(); as code) {
        <p class="title">Que lo escaneen desde sus teléfonos</p>

        <svg
          class="qr"
          [attr.viewBox]="'0 0 ' + code.size + ' ' + code.size"
          role="img"
          aria-label="Código para unirse a la mesa"
        >
          <rect [attr.width]="code.size" [attr.height]="code.size" fill="white" />
          <path [attr.d]="code.path" fill="black" />
        </svg>

        <!-- El contador no es decoración: sin él, el que escanea tarde ve un
             error sin entender por qué, y vuelve a pedir otro. -->
        <p class="expiry" [class.soon]="secondsLeft() <= 60" aria-live="polite">
          @if (secondsLeft() > 0) {
            Vence en {{ clock() }} · lo pueden escanear todos
          } @else {
            Venció. Generá otro para seguir sumando gente.
          }
        </p>

        @if (secondsLeft() <= 0) {
          <button type="button" class="again" [disabled]="busy()" (click)="generate()">
            Generar otro
          </button>
        }
      } @else if (busy()) {
        <p class="title">Generando…</p>
      } @else {
        <p class="title">No pudimos generar la invitación</p>
        <button type="button" class="again" (click)="generate()">Probar de nuevo</button>
      }

      <button type="button" class="cancel" (click)="close()">Cerrar</button>
    </div>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 41;
      background: oklch(24% 0.02 40 / 0.35);
    }

    .sheet {
      position: fixed;
      left: 12px;
      right: 12px;
      bottom: calc(1rem + env(safe-area-inset-bottom));
      z-index: 42;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      padding: 1.1rem;
      border-radius: var(--itadaki-radius-panel);
      background: var(--itadaki-surface-raised);
      box-shadow: var(--itadaki-shadow-panel);
    }

    .title {
      margin: 0;
      font-family: var(--itadaki-font-display);
      font-weight: 700;
      font-size: 0.95rem;
      color: var(--itadaki-ink-strong);
      text-align: center;
    }

    /* Grande: se escanea desde otro teléfono, a un brazo de distancia. */
    .qr {
      width: min(62vw, 240px);
      height: auto;
      border-radius: 8px;
      background: white;
      padding: 8px;
    }

    .expiry {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--itadaki-ink-subtle);
    }

    .expiry.soon {
      color: var(--itadaki-accent);
    }

    .again {
      border: 1.5px solid var(--itadaki-border);
      border-radius: var(--itadaki-radius-pill);
      background: var(--itadaki-surface);
      padding: 0.6rem 1.1rem;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--itadaki-ink-strong);
      cursor: pointer;
      min-height: 44px;
    }

    .cancel {
      border: none;
      background: none;
      padding: 0.5rem;
      font-family: inherit;
      font-size: 0.83rem;
      font-weight: 600;
      color: var(--itadaki-ink-subtle);
      cursor: pointer;
    }
  `,
})
export class InviteSheetComponent implements OnDestroy {
  private readonly session = inject(SessionStore);

  protected readonly busy = signal(false);
  private readonly invite = signal<{ url: string; expiresAt: number } | null>(null);

  /** Avanza solo para que el contador baje sin depender de ningún evento. */
  private readonly tick = signal(Date.now());
  private readonly timer = setInterval(() => this.tick.set(Date.now()), 1000);

  protected readonly secondsLeft = computed(() => {
    const current = this.invite();
    if (current === null) return 0;
    return Math.max(0, Math.ceil((current.expiresAt - this.tick()) / 1000));
  });

  protected readonly clock = computed(() => {
    const total = this.secondsLeft();
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  });

  protected readonly qr = computed(() => {
    const current = this.invite();
    if (current === null) return null;

    const matrix = encodeQr(current.url);
    if (isQrError(matrix)) return null;
    return { path: qrToSvgPath(matrix), size: matrix.size };
  });

  constructor() {
    void this.generate();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected async generate(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);

    const created = await this.session.invite();
    this.invite.set(created);
    this.busy.set(false);
  }

  protected close(): void {
    this.session.closeInvite();
  }
}
