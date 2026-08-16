import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { type Modifier, type ModifierGroup, type Product } from '@itadaki/catalog/domain';
import { type ModifierSnapshot } from '@itadaki/ordering/domain';
import { Money } from '@itadaki/shared/domain';
import { goBack } from './back';
import { MODIFIER_GROUPS_TOKEN, PRODUCT_READER, TENANT } from './catalog.tokens';
import { CartStore } from './cart.store';
import { SessionStore } from './session.store';
import { ToastStore } from './toast.store';
import { MoneyPipe } from './money.pipe';

@Component({
  selector: 'itd-product',
  standalone: true,
  imports: [RouterLink, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './product.page.css',
  template: `
    @if (product(); as item) {
      <!-- Botón y no enlace: routerLink apilaba una entrada más, así que
           volver acá y después tocar atrás del navegador te devolvía al plato
           que acababas de cerrar. -->
      <button type="button" class="back" aria-label="Volver a la carta" (click)="back()">
        ←
      </button>

      @if (item.images; as set) {
        <picture class="hero-pic">
          <source [srcset]="heroSrcset(set, 'avif')" type="image/avif" />
          <source [srcset]="heroSrcset(set, 'webp')" type="image/webp" />
          <img
            class="hero-img"
            [src]="heroFallback(set)"
            [style.background-image]="'url(' + set.lqip + ')'"
            [alt]="set.alt || item.name"
            width="600"
            height="600"
            decoding="async"
          />
        </picture>
      } @else {
        <div class="hero" aria-hidden="true">
          <span>{{ item.name }}</span>
        </div>
      }

      <main class="body">
        <h1 class="name">{{ display(item.name) }}</h1>
        <p class="price">{{ item.price | money }}</p>
        <p class="desc">{{ display(item.description) }}</p>

        @if (item.allergens.length > 0) {
          <p class="allergens">Contiene {{ allergenLabels(item) }}</p>
        }

        @for (group of groups(); track group.id) {
          <section class="group">
            <h2 class="group-title">{{ display(group.name) }}</h2>
            @if (group.maxSelections < group.modifiers.length) {
              <p class="group-hint">Elegí hasta {{ group.maxSelections }}</p>
            }
            <div class="options">
              @for (modifier of group.modifiers; track modifier.id) {
                <button
                  type="button"
                  class="option"
                  [attr.aria-pressed]="isSelected(modifier.id)"
                  [disabled]="!modifier.available"
                  (click)="toggleModifier(group, modifier)"
                >
                  <span>{{ display(modifier.name) }}</span>
                  <span class="option-price">
                    {{ modifier.priceDelta.isZero() ? 'Sin cargo' : '+' + (modifier.priceDelta | money) }}
                  </span>
                </button>
              }
            </div>
          </section>
        }

        <label class="notes-label" for="item-notes">Nota para la cocina <em>(opcional)</em></label>
        <input
          id="item-notes"
          class="notes"
          type="text"
          placeholder="Ej: sin cebolla"
          [value]="notes()"
          (input)="onNotes($event)"
        />
      </main>

      <footer class="foot">
        @if (addError(); as message) {
          <p class="add-error" role="alert">{{ message }}</p>
        }
        <div class="foot-row">
          <div class="stepper" role="group" aria-label="Cantidad">
            <button type="button" class="step" (click)="changeQty(-1)" aria-label="Quitar uno">–</button>
            <span class="qty" aria-live="polite">{{ quantity() }}</span>
            <button type="button" class="step" (click)="changeQty(1)" aria-label="Agregar uno">+</button>
          </div>
          <button type="button" class="cta" [disabled]="adding()" (click)="addToCart(item)">
            {{ adding() ? 'Agregando…' : 'Agregar · ' + (lineTotal() | money) }}
          </button>
        </div>
      </footer>
    } @else if (failed()) {
      <div class="loading">
        <p>No pudimos cargar este plato.</p>
        <a class="back-link" routerLink="/carta">Volver a la carta</a>
      </div>
    } @else {
      <p class="loading">Cargando…</p>
    }
  `,
})
export class ProductPage {
  readonly id = input.required<string>();

  private readonly products = inject(PRODUCT_READER);
  private readonly tenant = inject(TENANT);
  private readonly allGroups = inject(MODIFIER_GROUPS_TOKEN);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly cart = inject(CartStore);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(ToastStore);

  protected back(): void {
    goBack(this.location, this.router, '/carta');
  }

  protected readonly product = signal<Product | null>(null);
  protected readonly failed = signal(false);
  protected readonly quantity = signal(1);
  protected readonly notes = signal('');
  protected readonly selected = signal<readonly string[]>([]);
  protected readonly adding = signal(false);
  protected readonly addError = signal<string | null>(null);

  private readonly loadedGroups = signal<readonly ModifierGroup[]>([]);

  protected readonly groups = computed<readonly ModifierGroup[]>(() => {
    const current = this.product();
    return current === null
      ? []
      : this.loadedGroups().filter((group) => group.productId === current.id);
  });

  /** Unit price plus selected deltas, times quantity — same math the cart will redo. */
  protected readonly lineTotal = computed<Money>(() => {
    const current = this.product();
    if (current === null) return Money.zero('ARS');

    const withModifiers = this.selectedModifiers().reduce(
      (acc, modifier) => acc.flatMap((sum) => sum.add(modifier.priceDelta)),
      Money.of(current.price.amountInMinorUnits, current.price.currency),
    );

    const scaled = withModifiers.flatMap((unit) => unit.multiply(this.quantity()));
    return scaled.isOk() ? scaled.value : current.price;
  });

  constructor() {
    // Reads the `id` input, so it must run after Angular has set inputs —
    // touching a required input from the constructor throws. Re-running on
    // change also reloads when navigating straight from one dish to another.
    effect(() => {
      const productId = this.id();
      this.product.set(null);
      this.failed.set(false);
      this.quantity.set(1);
      this.notes.set('');
      this.selected.set([]);
      void this.load(productId);
    });
  }

  private async load(productId: string): Promise<void> {
    try {
      const [found, groups] = await Promise.all([
        this.products.findById(this.tenant, productId),
        this.allGroups(),
      ]);

      // A late response for a dish the diner already navigated away from
      // must not overwrite the current one.
      if (productId !== this.id()) return;

      if (found.isOk()) {
        this.product.set(found.value);
      } else {
        this.failed.set(true);
      }
      this.loadedGroups.set(groups);
    } catch {
      if (productId === this.id()) this.failed.set(true);
    }
  }

  private selectedModifiers(): readonly ModifierSnapshot[] {
    const ids = this.selected();
    return this.groups()
      .flatMap((group) => group.modifiers)
      .filter((modifier) => ids.includes(modifier.id))
      .map((modifier) => ({
        modifierId: modifier.id,
        name: modifier.name,
        priceDelta: modifier.priceDelta,
      }));
  }

  /** Sentence case for display; the stored name is never rewritten. */
  protected display(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '') return trimmed;
    return trimmed.charAt(0).toLocaleUpperCase('es-AR') + trimmed.slice(1);
  }

  protected heroSrcset(set: NonNullable<Product['images']>, format: string): string {
    return set.variants
      .filter((variant) => variant.format === format)
      .map((variant) => `${variant.url} ${variant.width}w`)
      .join(', ');
  }

  protected heroFallback(set: NonNullable<Product['images']>): string {
    const jpeg = set.variants.filter((variant) => variant.format === 'jpeg');
    return jpeg.find((variant) => variant.width === 600)?.url ?? jpeg[0]?.url ?? '';
  }

  protected isSelected(modifierId: string): boolean {
    return this.selected().includes(modifierId);
  }

  /** Honours the group's maxSelections: the oldest pick drops when full. */
  protected toggleModifier(group: ModifierGroup, modifier: Modifier): void {
    this.selected.update((current) => {
      if (current.includes(modifier.id)) {
        return current.filter((id) => id !== modifier.id);
      }

      const groupIds = group.modifiers.map((candidate) => candidate.id);
      const inGroup = current.filter((id) => groupIds.includes(id));

      if (inGroup.length >= group.maxSelections) {
        const [oldest, ...rest] = inGroup;
        return [...current.filter((id) => id !== oldest && !rest.includes(id)), ...rest, modifier.id];
      }
      return [...current, modifier.id];
    });
  }

  protected changeQty(delta: number): void {
    this.quantity.update((current) => Math.max(1, current + delta));
  }

  protected onNotes(event: Event): void {
    this.notes.set((event.target as HTMLInputElement).value);
  }

  protected allergenLabels(product: Product): string {
    const labels: Record<string, string> = {
      GLUTEN: 'gluten',
      LACTOSE: 'lactosa',
      NUTS: 'frutos secos',
      PEANUTS: 'maní',
      EGG: 'huevo',
      FISH: 'pescado',
      SHELLFISH: 'mariscos',
      SOY: 'soja',
    };
    return product.allergens.map((allergen) => labels[allergen] ?? allergen.toLowerCase()).join(', ');
  }

  /**
   * Adds to the shared table cart when joined; falls back to the local cart.
   *
   * A failed add used to navigate away anyway, so the diner returned to the
   * carte believing a dish was in the cart that never made it. Now the screen
   * stays put and says so.
   */
  protected async addToCart(product: Product): Promise<void> {
    if (this.adding()) return;
    this.addError.set(null);

    if (this.session.isJoined()) {
      this.adding.set(true);
      const added = await this.session.addLine(
        product.id,
        this.quantity(),
        this.notes().trim(),
        this.selectedModifiers().map((modifier) => modifier.modifierId),
      );
      this.adding.set(false);

      if (!added) {
        this.addError.set('No pudimos agregarlo. Probá de nuevo.');
        return;
      }
    } else {
      this.cart.add(product, this.quantity(), this.selectedModifiers(), this.notes().trim());
    }

    // Confirmation belongs on the carte, where the diner is about to land and
    // where the cart bar shows the new total.
    this.toast.show(`${product.name} agregado`);
    void this.router.navigate(['/carta']);
  }
}
