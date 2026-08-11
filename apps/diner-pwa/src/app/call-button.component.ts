import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { type CallReason } from '@itadaki/ordering/domain';
import { CallStore } from './call.store';
import { SessionStore } from './session.store';

const OPTIONS: ReadonlyArray<{ reason: CallReason; label: string; hint: string }> = [
  { reason: 'WAITER', label: 'Llamar al mozo', hint: 'Alguien se acerca a la mesa' },
  { reason: 'BILL', label: 'Pedir la cuenta', hint: 'La preparan y te la traen' },
  { reason: 'QUESTION', label: 'Tengo una duda', hint: 'Sobre un plato o la carta' },
];

/**
 * Raising a hand, without raising a hand.
 *
 * Floating and always reachable because the moment someone needs a waiter is
 * never predictable — it is not a step in the ordering flow.
 */
@Component({
  selector: 'itd-call-button',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './call-button.component.css',
  template: `
    @if (session.isJoined()) {
      @if (open()) {
        <div class="sheet-backdrop" (click)="open.set(false)"></div>
        <div class="sheet" role="dialog" aria-label="Llamar a alguien">
          <p class="sheet-title">¿Qué necesitás?</p>

          @for (option of options; track option.reason) {
            <button
              type="button"
              class="option"
              [disabled]="calls.busy() || waiting(option.reason)"
              (click)="raise(option.reason)"
            >
              <span class="option-text">
                <span class="option-label">{{ option.label }}</span>
                <span class="option-hint">
                  {{ waiting(option.reason) ? 'Ya avisamos · ahí van' : option.hint }}
                </span>
              </span>
              @if (waiting(option.reason)) {
                <span class="option-tick" aria-hidden="true">✓</span>
              }
            </button>
          }

          @if (calls.error(); as message) {
            <p class="sheet-error" role="alert">{{ message }}</p>
          }

          <button type="button" class="cancel" (click)="open.set(false)">Cerrar</button>
        </div>
      }

      <button
        type="button"
        class="fab"
        [class.waiting]="anyWaiting()"
        [attr.aria-expanded]="open()"
        aria-label="Llamar a alguien"
        (click)="toggle()"
      >
        @if (anyWaiting()) {
          <span class="fab-dot" aria-hidden="true"></span>
        }
        <span aria-hidden="true">🔔</span>
      </button>
    }
  `,
})
export class CallButtonComponent {
  protected readonly calls = inject(CallStore);
  protected readonly session = inject(SessionStore);

  protected readonly options = OPTIONS;
  protected readonly open = signal(false);

  protected readonly anyWaiting = computed(() => this.calls.pending().length > 0);

  protected waiting(reason: CallReason): boolean {
    return this.calls.waitingFor().has(reason);
  }

  protected toggle(): void {
    const next = !this.open();
    this.open.set(next);

    // Refresh on open: another phone at the table may have called already.
    const sessionId = this.session.session()?.id;
    if (next && sessionId !== undefined) void this.calls.load(sessionId);
  }

  protected async raise(reason: CallReason): Promise<void> {
    const sessionId = this.session.session()?.id;
    if (sessionId === undefined) return;

    const done = await this.calls.raise(sessionId, reason);
    // Stay open on failure so the message is readable.
    if (done) setTimeout(() => this.open.set(false), 900);
  }
}
