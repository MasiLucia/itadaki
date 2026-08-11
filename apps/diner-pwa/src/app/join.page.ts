import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
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
      @if (!table.hasToken()) {
        <p class="no-token" role="alert">
          Escaneá el QR de tu mesa para poder pedir. Podés ver la carta igual.
        </p>
      }
      <p class="table">Tu mesa</p>
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

        @if (store.joinError(); as error) {
          <p class="error" role="alert">{{ error }}</p>
        }

        <button type="submit" class="cta" [disabled]="nickname().trim() === '' || busy() || !table.hasToken()">
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
  protected readonly busy = signal(false);

  protected onInput(event: Event): void {
    this.nickname.set((event.target as HTMLInputElement).value);
  }

  protected pick(name: string): void {
    this.nickname.set(name);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;

    this.busy.set(true);
    const joined = await this.store.join(this.nickname().trim());
    this.busy.set(false);

    if (joined) {
      void this.router.navigate(['/carta']);
    }
  }
}
