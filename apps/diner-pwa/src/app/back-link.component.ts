import { Location } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { goBack } from './back';

/**
 * Volver, sin pelearse con el historial.
 *
 * Hasta ahora sólo la ficha de un plato tenía cómo volver: en el carrito, el
 * estado y la cuenta había que usar el botón del navegador o el gesto del
 * teléfono, que en una PWA agregada al inicio ni siquiera están a la vista.
 *
 * Vuelve con `Location.back()` cuando ya hay historial propio, y recién si no
 * lo hay navega a la pantalla padre. Un `routerLink` fijo era lo simple, pero
 * apila una entrada nueva: el usuario tocaba "volver", después atrás del
 * navegador, y regresaba a la pantalla de la que acababa de salir. Así el
 * botón de la app y el del navegador hacen exactamente lo mismo.
 */
@Component({
  selector: 'itd-back',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="itd-back" [attr.aria-label]="'Volver a ' + label()" (click)="back()">
      <span class="itd-back-arrow" aria-hidden="true">←</span>
      <span class="itd-back-text">{{ label() }}</span>
    </button>
  `,
  styles: `
    .itd-back {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      /* Alineado con el texto de la cabecera, no metido hacia adentro: el
         padding sigue siendo zona táctil. */
      margin: 0 0 0.5rem -0.5rem;
      padding: 0.5rem;
      min-height: 44px;
      border: none;
      background: none;
      font-family: inherit;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--itadaki-ink-subtle);
      cursor: pointer;
    }

    .itd-back-arrow {
      font-size: 1.05rem;
      line-height: 1;
    }

    .itd-back:active .itd-back-arrow {
      transform: translateX(-2px);
    }
  `,
})
export class BackLinkComponent {
  /** A dónde volver cuando no hay historial: entrar por QR abre la app acá. */
  readonly to = input.required<string>();

  /** Cómo se llama esa pantalla, para que el botón diga a dónde lleva. */
  readonly label = input.required<string>();

  private readonly location = inject(Location);
  private readonly router = inject(Router);

  protected back(): void {
    goBack(this.location, this.router, this.to());
  }
}
