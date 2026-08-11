import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'itd-welcome',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './welcome.page.css',
  template: `
    <main class="welcome">
      <div class="bowl" aria-hidden="true">
        <span class="steam s1"></span>
        <span class="steam s2"></span>
        <span class="steam s3"></span>
      </div>

      <p class="table">mesa 07</p>
      <h1 class="greeting">itadakimasu!</h1>
      <p class="lede">bienvenido a ITADAKI. tu mesa ya está lista — armá tu pedido cuando quieras.</p>

      <a class="cta" routerLink="/unirse">ver la carta →</a>

      <div class="dots" aria-hidden="true">
        <span class="dot d1"></span>
        <span class="dot d2"></span>
        <span class="dot d3"></span>
      </div>
    </main>
  `,
})
export class WelcomePage {}
