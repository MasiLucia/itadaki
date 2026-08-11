import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { AuthStore } from './auth.store';

/** Sign-in screen shared by the admin panel and the kitchen display. */
@Component({
  selector: 'itd-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './login.component.css',
  template: `
    <main class="screen">
      @if (mode() === 'reset') {
        <form class="card" (submit)="submitReset($event)">
          <header class="head">
            <p class="eyebrow">{{ context() }}</p>
            <h1 class="title">ITADAKI</h1>
            <p class="lede">Elegí tu contraseña nueva.</p>
          </header>

          <label class="field">
            <span>Contraseña nueva</span>
            <input
              type="password"
              autocomplete="new-password"
              required
              [value]="password()"
              (input)="onPassword($event)"
            />
            <small class="hint">Mínimo 8 caracteres</small>
          </label>

          @if (auth.error(); as message) {
            <p class="error" role="alert">{{ message }}</p>
          }

          <button type="submit" class="cta" [disabled]="auth.busy() || password() === ''">
            {{ auth.busy() ? 'Guardando…' : 'Guardar y entrar' }}
          </button>
        </form>
      } @else {
      <form class="card" (submit)="submit($event)">
        <header class="head">
          <p class="eyebrow">{{ context() }}</p>
          <h1 class="title">ITADAKI</h1>
          <p class="lede">
            {{
              registering()
                ? 'Creá la cuenta de tu restaurante. Es gratis y toma un minuto.'
                : 'Ingresá con tu cuenta del restaurante.'
            }}
          </p>
        </header>

        @if (registering()) {
          <label class="field">
            <span>Nombre del restaurante</span>
            <input
              name="restaurant"
              type="text"
              autocomplete="organization"
              maxlength="60"
              required
              placeholder="Ej: Parrilla Don José"
              [value]="restaurant()"
              (input)="onRestaurant($event)"
            />
          </label>
        }

        <label class="field">
          <span>Email</span>
          <input
            name="email"
            type="email"
            autocomplete="username"
            required
            [value]="email()"
            (input)="onEmail($event)"
          />
        </label>

        <label class="field">
          <span>Contraseña</span>
          <input
            name="password"
            type="password"
            [attr.autocomplete]="registering() ? 'new-password' : 'current-password'"
            required
            [value]="password()"
            (input)="onPassword($event)"
          />
          @if (registering()) {
            <small class="hint">Mínimo 8 caracteres</small>
          }
        </label>

        @if (resetSent()) {
          <p class="notice" role="status">
            Si ese email tiene cuenta, le mandamos un link para cambiar la contraseña.
          </p>
        }

        @if (auth.error(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }

        <button type="submit" class="cta" [disabled]="auth.busy() || !filled()">
          {{ busyLabel() }}
        </button>

        @if (!registering()) {
          <button
            type="button"
            class="link forgot"
            [disabled]="auth.busy()"
            (click)="forgot()"
          >
            Olvidé mi contraseña
          </button>
        }

        @if (googleClientId(); as clientId) {
          <div class="divider"><span>o</span></div>
          <div class="google-slot" #googleSlot></div>
          @if (needsRestaurant()) {
            <p class="notice" role="status">
              Es tu primera vez acá. Escribí el nombre de tu restaurante arriba y
              volvé a tocar el botón de Google.
            </p>
          }
        }

        @if (allowSignUp()) {
        <p class="switch">
          @if (registering()) {
            ¿Ya tenés cuenta?
            <button type="button" class="link" (click)="setMode(false)">Entrar</button>
          } @else {
            ¿Todavía no tenés cuenta?
            <button type="button" class="link" (click)="setMode(true)">
              Registrá tu restaurante
            </button>
          }
        </p>
        }
      </form>
      }
    </main>
  `,
})
export class LoginComponent {
  /** Shown above the title, e.g. "Administración" or "Cocina". */
  readonly context = input('Acceso del personal');

  /** Hidden where signing up makes no sense, e.g. the kitchen display. */
  readonly allowSignUp = input(true);

  protected readonly auth = inject(AuthStore);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly restaurant = signal('');
  protected readonly registering = signal(false);
  protected readonly resetSent = signal(false);
  protected readonly needsRestaurant = signal(false);
  protected readonly googleClientId = signal<string | null>(null);
  /** 'reset' when the page was opened from a reset link. */
  protected readonly mode = signal<'auth' | 'reset'>('auth');

  private readonly googleSlot = viewChild<ElementRef<HTMLElement>>('googleSlot');
  private resetToken = '';

  constructor() {
    const params = new URLSearchParams(globalThis.location.search);
    const token = params.get('reset');
    if (token !== null && token !== '') {
      this.resetToken = token;
      this.mode.set('reset');
      // Keep the token out of the address bar and out of any shared screenshot.
      const clean = new URL(globalThis.location.href);
      clean.searchParams.delete('reset');
      globalThis.history.replaceState({}, '', clean.toString());
    }

    void this.setUpGoogle();
  }

  /**
   * Loads Google's script only when a client id is configured.
   *
   * Nothing is requested from Google when sign-in is off, so a deployment
   * without it stays free of third-party calls.
   */
  private async setUpGoogle(): Promise<void> {
    const providers = await this.auth.providers();
    if (providers.google === null) return;

    this.googleClientId.set(providers.google.clientId);
    await loadGoogleScript();

    // The slot only exists after the signal above renders it.
    setTimeout(() => {
      const slot = this.googleSlot()?.nativeElement;
      const google = (globalThis as unknown as { google?: GoogleAccounts }).google;
      if (slot === undefined || google === undefined) return;

      google.accounts.id.initialize({
        client_id: providers.google?.clientId ?? '',
        callback: (response) => void this.onGoogleCredential(response.credential),
      });
      google.accounts.id.renderButton(slot, {
        theme: 'outline',
        size: 'large',
        width: 280,
        text: 'continue_with',
        locale: 'es',
      });
    });
  }

  private async onGoogleCredential(idToken: string): Promise<void> {
    const restaurant = this.restaurant().trim();
    const result = await this.auth.signInWithGoogle(
      idToken,
      restaurant === '' ? undefined : restaurant,
    );

    if (result === 'needs-restaurant') {
      // First time with this address: switch to the signup form so the
      // restaurant field is visible, and say why.
      this.registering.set(true);
      this.needsRestaurant.set(true);
    }
  }

  protected async forgot(): Promise<void> {
    const email = this.email().trim();
    if (email === '') {
      this.auth.error.set('Escribí tu email y volvé a tocar');
      return;
    }

    const sent = await this.auth.requestReset(email);
    if (sent) this.resetSent.set(true);
  }

  protected async submitReset(event: Event): Promise<void> {
    event.preventDefault();
    if (this.password() === '' || this.auth.busy()) return;

    const done = await this.auth.resetPassword(this.resetToken, this.password());
    if (done) {
      // The reset does not sign anyone in, so land them on the login form with
      // the password they just chose.
      this.mode.set('auth');
      this.password.set('');
      this.resetSent.set(false);
      this.auth.error.set(null);
    }
  }

  protected filled(): boolean {
    const credentials = this.email().trim() !== '' && this.password() !== '';
    return this.registering() ? credentials && this.restaurant().trim() !== '' : credentials;
  }

  protected busyLabel(): string {
    if (this.auth.busy()) return this.registering() ? 'Creando…' : 'Entrando…';
    return this.registering() ? 'Crear mi restaurante' : 'Entrar';
  }

  protected setMode(registering: boolean): void {
    this.registering.set(registering);
    this.resetSent.set(false);
    this.needsRestaurant.set(false);
    // An error from the other mode would read as a comment on this one.
    this.auth.error.set(null);
  }

  protected onEmail(event: Event): void {
    this.email.set((event.target as HTMLInputElement).value);
  }

  protected onPassword(event: Event): void {
    this.password.set((event.target as HTMLInputElement).value);
  }

  protected onRestaurant(event: Event): void {
    this.restaurant.set((event.target as HTMLInputElement).value);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.filled() || this.auth.busy()) return;

    if (this.registering()) {
      await this.auth.signUp(this.restaurant().trim(), this.email().trim(), this.password());
      return;
    }
    await this.auth.signIn(this.email().trim(), this.password());
  }
}

interface GoogleAccounts {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
      }): void;
      renderButton(target: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

let scriptPromise: Promise<void> | null = null;

/** Loaded once per page, however many times the login screen mounts. */
function loadGoogleScript(): Promise<void> {
  if (scriptPromise !== null) return scriptPromise;

  scriptPromise = new Promise<void>((resolve) => {
    const existing = document.querySelector('script[data-itadaki-google]');
    if (existing !== null) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset['itadakiGoogle'] = 'true';
    script.addEventListener('load', () => resolve());
    // Resolve on failure too: the caller checks for the global before using it.
    script.addEventListener('error', () => resolve());
    document.head.appendChild(script);
  });

  return scriptPromise;
}
