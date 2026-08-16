import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SessionStore } from './session.store';
import { TableTokenStore } from './table-token.store';

const SUGGESTIONS = ['Ana', 'Beto', 'Cami', 'Dani', 'Eli', 'Fede', 'Gaby', 'Nico'];

@Component({
  selector: 'itd-join',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './join.page.css',
  template: `
    <main class="join">
      @if (!puedeEntrar()) {
        <p class="no-token" role="alert">
          Escaneá el QR de tu mesa para poder pedir. Podés ver la carta igual.
        </p>
      }
      <p class="table">
        @if (table.tableLabel(); as mesa) { Mesa {{ mesa }} } @else { Tu mesa }
      </p>
      <h1 class="title">¿Cómo te llamamos?</h1>
      <p class="lede">
        Elegí un nombre para que el resto de la mesa vea qué pediste. No pedimos mail ni cuenta.
      </p>

      <form class="form" (submit)="submit($event)">
        <label class="itd-visually-hidden" for="nickname">Tu nombre en la mesa</label>
        <input
          id="nickname"
          class="input"
          type="text"
          maxlength="20"
          autocomplete="off"
          placeholder="Tu nombre"
          [value]="nickname()"
          (input)="onInput($event)"
        />

        <div class="chips">
          @for (name of suggestions; track name) {
            <button type="button" class="chip" (click)="pick(name)">{{ name }}</button>
          }
        </div>

        <!-- Quien llegó por el QR de un amigo ya está autorizado: la
             invitación lo prueba, y pedirle además el PIN sería mandarlo a
             preguntar en voz alta justo lo que el QR vino a evitar. -->
        @if (table.invite() !== null) {
          <p class="code-hint invited">Te invitaron a la mesa — no hace falta código.</p>
        } @else {
          <!-- Desde el primero: el código es de la mesa y existe antes de que
               nadie escanee. Es lo único que separa a quien está sentado en el
               salón de quien tiene una foto del QR en el teléfono. -->
          <label class="code-label" for="join-code">Código de la mesa</label>
          <p class="code-hint">
            Te lo da el mozo al sentarte. Si ya hay alguien de tu mesa adentro,
            te puede invitar desde su teléfono.
          </p>
          <input
            id="join-code"
            class="input code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="000000"
            [value]="code()"
            (input)="onCode($event)"
          />
        }

        @if (store.joinError(); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }

        <button
          type="submit"
          class="cta"
          [disabled]="nickname().trim() === '' || !codeReady() || busy() || !puedeEntrar()"
        >
          {{ busy() ? 'Entrando…' : 'Entrar a la mesa →' }}
        </button>
      </form>
    </main>
  `,
})
export class JoinPage {
  protected readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  protected readonly table = inject(TableTokenStore);

  protected readonly suggestions = SUGGESTIONS;
  protected readonly nickname = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);

  /** Con invitación no hay código que completar: ya viene autorizado. */
  protected readonly codeReady = computed(
    () => this.table.invite() !== null || this.code().length === 6,
  );

  /**
   * Quien llega por invitación todavía no tiene token de mesa — lo recibe al
   * entrar — así que exigirlo acá lo dejaba con el botón muerto.
   */
  protected readonly puedeEntrar = computed(
    () => this.table.hasToken() || this.table.invite() !== null,
  );

  protected onInput(event: Event): void {
    this.nickname.set((event.target as HTMLInputElement).value);
  }

  /** Sólo dígitos: quien lo dicta a veces lo separa, "12 34 56". */
  protected onCode(event: Event): void {
    this.code.set((event.target as HTMLInputElement).value.replace(/\D/g, ''));
  }

  protected pick(name: string): void {
    this.nickname.set(name);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;

    this.busy.set(true);
    const joined = await this.store.join(this.nickname().trim(), this.code());
    this.busy.set(false);

    if (joined) {
      void this.router.navigate(['/carta']);
    }
  }
}
