import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { type PaymentMethod } from '@itadaki/ordering/domain';

/**
 * Cómo paga la mesa, que es lo único que el mozo necesita saber antes de
 * levantarse: si lleva el posnet, si lleva cambio, o si no tiene que ir.
 *
 * "Vamos a la caja" no es una forma de pago más: ahí nadie cobra en la mesa y
 * el sistema no se entera de si pagaron, así que la cuenta la cierra el local
 * a mano. Por eso va con su explicación y no como una palabra suelta.
 *
 * "Todavía no sabemos" es una respuesta, no una respuesta faltante: el mozo se
 * acerca igual y lo resuelven ahí.
 */
const PAYMENT_OPTIONS: ReadonlyArray<{ method: PaymentMethod; label: string; hint: string }> = [
  { method: 'CARD', label: 'con tarjeta', hint: 'te llevan el posnet a la mesa' },
  { method: 'CASH', label: 'en efectivo', hint: 'te llevan el cambio' },
  { method: 'COUNTER', label: 'vamos a la caja', hint: 'pagan al salir, en el mostrador' },
  { method: 'UNDECIDED', label: 'todavía no sabemos', hint: 'lo definen en la mesa' },
];

/**
 * La misma pregunta, se llegue por donde se llegue.
 *
 * Estaba escrita dos veces —en el timbre y al pie de la cuenta— y las dos
 * versiones no ofrecían lo mismo: desde el timbre no se podía decir que
 * pagaban en la caja, y desde la cuenta no se podía decir que todavía no
 * sabían. La mesa no sabe que son dos pantallas distintas; contesta lo que le
 * preguntan.
 */
@Component({
  selector: 'itd-payment-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './payment-sheet.component.css',
  // Escape cierra la pregunta: en un teclado es lo que la mano ya hace, y en
  // el teléfono no molesta a nadie.
  host: { '(document:keydown.escape)': 'close.emit()' },
  template: `
    <div class="backdrop" (click)="close.emit()"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <p class="title" id="pay-title">¿cómo van a pagar?</p>
      <p class="note">le avisamos al mozo para que venga con lo que haga falta</p>

      @for (option of options; track option.method) {
        <button
          type="button"
          class="option"
          [disabled]="busy()"
          (click)="choose.emit(option.method)"
        >
          <span class="label">{{ option.label }}</span>
          <span class="hint">{{ option.hint }}</span>
        </button>
      }

      @if (error(); as message) {
        <p class="note" role="alert">{{ message }}</p>
      }

      <button type="button" class="cancel" (click)="close.emit()">{{ cancelLabel() }}</button>
    </div>
  `,
})
export class PaymentSheetComponent {
  readonly busy = input(false);
  readonly error = input<string | null>(null);

  /** "volver" cuando hay un paso atrás; "cancelar" cuando la hoja es el paso. */
  readonly cancelLabel = input('cancelar');

  readonly choose = output<PaymentMethod>();
  readonly close = output<void>();

  protected readonly options = PAYMENT_OPTIONS;
}
