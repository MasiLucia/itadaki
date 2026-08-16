import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { type Category, type DietTag, type Product } from '@itadaki/catalog/domain';
import { DINER_PALETTE } from '@itadaki/shared/ui-tokens';
import { MODIFIER_GROUPS_TOKEN, CATEGORY_READER, PRODUCT_READER, TENANT } from './catalog.tokens';
import { CartStore } from './cart.store';
import { SessionStore } from './session.store';
import { MoneyPipe } from './money.pipe';
import { ToastStore } from './toast.store';

const DIET_LABELS: ReadonlyArray<{ tag: DietTag; label: string }> = [
  { tag: 'VEGAN', label: 'Vegano' },
  { tag: 'VEGETARIAN', label: 'Vegetariano' },
  { tag: 'GLUTEN_FREE', label: 'Sin gluten' },
  { tag: 'LACTOSE_FREE', label: 'Sin lactosa' },
];

@Component({
  selector: 'itd-menu',
  standalone: true,
  imports: [RouterLink, MoneyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './menu.page.css',
  template: `
    <header class="pad">
      <!-- La mesa y quiénes están sentados, arriba a la derecha y dentro del
           documento. Antes los avatares eran una barra fija sobre el pie: se
           quedaba quieta mientras la carta se movía debajo y tapaba una franja
           de platos en cada scroll. Acá se lee una vez, al llegar. -->
      <div class="head-top">
        <h1 class="title">Nuestra carta</h1>

        @if (session.isJoined()) {
          <aside class="table-tag" aria-label="Mesa y comensales">
            <p class="table-tag-name">Mesa {{ session.tableLabel() }}</p>

            <!-- Una fila, sea una mesa de dos o un cumpleaños de doce. Con
                 todos los círculos, una mesa llena ocupaba tres filas y
                 empujaba el buscador y los chips fuera de la pantalla. -->
            <div class="table-tag-diners">
              @for (diner of visibleDiners(); track diner.id) {
                <span
                  class="avatar"
                  [style.background]="dinerColor(diner.colorIndex)"
                  [attr.title]="diner.nickname"
                >{{ initials(diner.nickname) }}</span>
              }
              @if (hiddenDiners() > 0) {
                <span class="avatar avatar-more" [attr.title]="hiddenNames()">
                  +{{ hiddenDiners() }}
                </span>
              }
            </div>

            <!-- aria-live: alguien que se suma a la mesa aparece sin recargar,
                 y un lector de pantalla no tiene cómo notarlo si no se anuncia. -->
            <p class="table-tag-count" aria-live="polite">
              {{ dinerCount() }} en la mesa
              @if (session.connected()) { · en vivo }
            </p>

            <!-- Para el que llega tarde: un QR de un solo uso en vez del PIN.
                 Mostrar el PIN para que un amigo lo copie era mostrárselo
                 también a quien mirara desde la mesa de al lado. -->
            <button type="button" class="join-code-toggle" (click)="session.openInvite()">
              Invitar a alguien
            </button>
          </aside>
        }
      </div>

      <div class="search-row">
        <label class="itd-visually-hidden" for="menu-search">Buscar en la carta</label>
        <input
          id="menu-search"
          type="search"
          class="search"
          placeholder="Buscar plato…"
          [value]="search()"
          (input)="onSearch($event)"
        />
      </div>

      <nav class="chips" aria-label="Categorías">
        <button
          type="button"
          class="chip"
          [attr.aria-pressed]="activeCategory() === null"
          (click)="selectCategory(null)"
        >
          Todo
        </button>
        @for (category of categories(); track category.id) {
          <button
            type="button"
            class="chip"
            [attr.aria-pressed]="activeCategory() === category.id"
            (click)="selectCategory(category.id)"
          >
            {{ display(category.name) }}
          </button>
        }
      </nav>

      <div class="diets" role="group" aria-label="Filtros de dieta">
        <span class="diets-label">Filtrar por</span>
        <div class="diet-list">
          @for (diet of dietOptions; track diet.tag) {
            <!-- role=checkbox, not aria-pressed: a screen reader should say
                 "checkbox, not checked", which announces that these stack. -->
            <button
              type="button"
              class="chip-diet"
              role="checkbox"
              [attr.aria-checked]="activeDiets().includes(diet.tag)"
              (click)="toggleDiet(diet.tag)"
            >
              <!-- The box is the affordance: a tick reads as "and also", where
                   a filled pill would read as "instead". -->
              <span class="diet-box" aria-hidden="true">
                <svg viewBox="0 0 12 12" class="diet-tick">
                  <path d="M2.5 6.2 L4.8 8.5 L9.5 3.5" />
                </svg>
              </span>
              {{ diet.label }}
            </button>
          }
          @if (activeDiets().length > 0) {
            <button type="button" class="diet-clear" (click)="clearDiets()">
              Limpiar
            </button>
          }
        </div>
      </div>
    </header>

    <main class="carte" aria-live="polite">
      @for (section of sections(); track section.id) {
        <section class="section">
          <header class="section-head">
            <h2 class="section-name">{{ display(section.name) }}</h2>
            <span class="section-rule" aria-hidden="true"></span>
          </header>

          <div class="list">
            @for (product of section.products; track product.id) {
              <article class="card">
              <a class="card-link" [routerLink]="['/producto', product.id]">
          @if (product.images; as set) {
            <picture class="photo-pic">
              <source [srcset]="srcset(set, 'avif')" type="image/avif" />
              <source [srcset]="srcset(set, 'webp')" type="image/webp" />
              <img
                class="photo"
                [src]="fallback(set)"
                [style.background-image]="'url(' + set.lqip + ')'"
                [alt]="set.alt || product.name"
                width="600"
                height="600"
                loading="lazy"
                decoding="async"
              />
            </picture>
          } @else {
            <span class="photo placeholder" aria-hidden="true">{{ initials(product.name) }}</span>
          }
          <span class="card-body">
            <span class="card-head">
              <span class="card-name">{{ display(product.name) }}</span>
              <span class="price">{{ product.price | money }}</span>
            </span>
            <span class="card-desc">{{ display(product.description) }}</span>
            @if (product.diets.length > 0) {
              <span class="tags">
                @for (diet of product.diets; track diet) {
                  <span class="tag">{{ dietLabel(diet) }}</span>
                }
              </span>
            }
          </span>
        </a>

        <!-- Adding from the carte skips a screen for the common case. A dish
             with a required choice still has to be opened — there is nothing
             to pick from here. -->
        @if (needsChoice(product.id)) {
          <a class="card-add choose" [routerLink]="['/producto', product.id]">
            Elegir opciones
          </a>
        } @else {
          <div class="card-actions">
            <button
              type="button"
              class="card-add"
              [disabled]="adding() === product.id"
              (click)="quickAdd(product)"
            >
              {{ adding() === product.id ? 'Agregando…' : 'Agregar' }}
            </button>

            <!-- Secundario a propósito: la mayoría pide el plato tal cual, y
                 dos botones con el mismo peso obligan a elegir dos veces. Dice
                 "Sin sal, sin cebolla…" y no "Agregar comentario" porque el
                 ejemplo se entiende sin leer: es lo que el mozo escucharía. -->
            <button
              type="button"
              class="card-note-btn"
              [class.open]="noting() === product.id"
              [attr.aria-expanded]="noting() === product.id"
              (click)="toggleNote(product.id)"
            >
              Sin sal, sin cebolla…
            </button>
          </div>

          @if (noting() === product.id) {
            <div class="note-box">
              <label class="itd-visually-hidden" [attr.for]="'note-' + product.id">
                Indicación para la cocina de {{ display(product.name) }}
              </label>
              <input
                [id]="'note-' + product.id"
                type="text"
                class="note-input"
                placeholder="Sin cebolla, bien cocido…"
                maxlength="280"
                [value]="note()"
                (input)="onNote($event)"
                (keydown.enter)="quickAdd(product, note())"
              />
              <button
                type="button"
                class="note-add"
                [disabled]="adding() === product.id || note().trim() === ''"
                (click)="quickAdd(product, note())"
              >
                {{ adding() === product.id ? 'Agregando…' : 'Agregar con indicación' }}
              </button>
            </div>
          }
        }
        </article>
            }
          </div>
        </section>
      } @empty {
        <p class="empty">
          No hay platos que coincidan con esos filtros.
          <button type="button" class="link" (click)="clearFilters()">Limpiar filtros</button>
        </p>
      }
    </main>

    <!-- También con el carrito vacío, si la mesa ya pidió: enviar a la
         cocina no borra lo consumido, y el pie es por dónde se llega a la
         cuenta y al estado del pedido. -->
    @if (sharedCount() > 0 || tableHasConsumed()) {
      <footer class="foot">
        <a class="cta" routerLink="/carrito">
          <!-- Sin el número suelto: "Ver pedido de la mesa · 3" se leía como
               si el 3 fuera la mesa, justo al lado de donde dice la mesa. -->
          <span>Ver pedido</span>
          <span>{{ sharedTotalLabel() }}</span>
        </a>
      </footer>
    }
  `,
})
export class MenuPage {
  private readonly products = inject(PRODUCT_READER);
  private readonly categoryReader = inject(CATEGORY_READER);
  private readonly tenant = inject(TENANT);

  private readonly allGroups = inject(MODIFIER_GROUPS_TOKEN);
  private readonly toast = inject(ToastStore);

  protected readonly cart = inject(CartStore);
  protected readonly session = inject(SessionStore);
  protected readonly adding = signal<string | null>(null);

  /** Qué plato tiene la indicación abierta: uno a la vez. */
  protected readonly noting = signal<string | null>(null);
  protected readonly note = signal('');

  /** Product ids whose modifiers must be chosen before ordering. */
  private readonly requiredChoices = signal<ReadonlySet<string>>(new Set());
  protected readonly dietOptions = DIET_LABELS;

  /**
   * Whether this dish cannot be added without opening it.
   *
   * A steak with a mandatory doneness has nothing to pick from on the carte,
   * so quick-adding it would send an incomplete order to the kitchen.
   */
  protected needsChoice(productId: string): boolean {
    return this.requiredChoices().has(productId);
  }

  /**
   * Adds one unit straight from the carte.
   *
   * Most dishes have no options, and making every one of them a two-screen
   * trip is the difference between ordering and giving up.
   *
   * La indicación viaja por el mismo camino que ya usaba la ficha del plato:
   * es el campo `notes` de la línea, que la cocina imprime debajo del nombre.
   */
  protected async quickAdd(product: Product, notes = ''): Promise<void> {
    if (this.adding() !== null) return;
    this.adding.set(product.id);

    const note = notes.trim();
    let ok = true;
    if (this.session.isJoined()) {
      ok = await this.session.addLine(product.id, 1, note, []);
    } else {
      this.cart.add(product, 1, [], note);
    }
    this.adding.set(null);
    this.closeNote();

    this.toast.show(ok ? `${product.name} agregado` : 'No pudimos agregarlo');
  }

  /**
   * Abre la indicación dentro de la propia tarjeta.
   *
   * En la tarjeta y no en una pantalla aparte: escribir "sin cebolla" no
   * justifica perder de vista la carta. La ficha del plato sigue teniendo su
   * campo de nota completo para cuando además hay que elegir opciones.
   */
  protected toggleNote(productId: string): void {
    const already = this.noting() === productId;
    this.noting.set(already ? null : productId);
    this.note.set('');
  }

  private closeNote(): void {
    this.noting.set(null);
    this.note.set('');
  }

  protected onNote(event: Event): void {
    this.note.set((event.target as HTMLInputElement).value);
  }

  protected readonly categories = signal<readonly Category[]>([]);
  protected readonly allProducts = signal<readonly Product[]>([]);
  protected readonly activeCategory = signal<string | null>(null);
  protected readonly activeDiets = signal<readonly DietTag[]>([]);
  protected readonly search = signal('');

  protected readonly dinerCount = computed(() => (this.session.session()?.diners ?? []).length);

  /**
   * Cuántos círculos entran en una fila al lado del título.
   *
   * Cuatro es lo que da el ancho del bloque; el quinto ya baja a otra fila y el
   * alto de la cabecera empieza a comerse la carta.
   */
  private readonly AVATAR_SLOTS = 4;

  protected readonly visibleDiners = computed(() => {
    const diners = this.session.session()?.diners ?? [];
    // Con uno solo de sobra conviene mostrarlo antes que poner "+1", que ocupa
    // exactamente lo mismo y dice menos.
    if (diners.length <= this.AVATAR_SLOTS + 1) return diners;
    return diners.slice(0, this.AVATAR_SLOTS);
  });

  protected readonly hiddenDiners = computed(
    () => this.dinerCount() - this.visibleDiners().length,
  );

  /** Los que no entraron, para el tooltip del "+N". */
  protected readonly hiddenNames = computed(() =>
    (this.session.session()?.diners ?? [])
      .slice(this.visibleDiners().length)
      .map((diner) => diner.nickname)
      .join(', '),
  );

  /**
   * Filtering runs in the view rather than re-querying: the whole menu is
   * already local, and a round trip per keystroke would cost more than it saves.
   */
  protected readonly visibleProducts = computed(() => {
    const needle = this.search().trim().toLowerCase();
    const category = this.activeCategory();
    const diets = this.activeDiets();

    return this.allProducts().filter((product) => {
      if (category !== null && product.categoryId !== category) return false;
      if (diets.length > 0 && !diets.every((diet) => product.diets.includes(diet))) return false;
      if (needle !== '') {
        const haystack = `${product.name} ${product.description}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [categories, products, groups] = await Promise.all([
      this.categoryReader.list(this.tenant),
      this.products.list(this.tenant, { onlyAvailable: true }),
      this.allGroups(),
    ]);

    if (categories.isOk()) this.categories.set(categories.value);
    if (products.isOk()) this.allProducts.set(products.value);

    // Only groups that demand a choice block quick-add; optional extras do not.
    this.requiredChoices.set(
      new Set(groups.filter((group) => group.minSelections > 0).map((group) => group.productId)),
    );
  }

  protected selectCategory(id: string | null): void {
    this.activeCategory.set(this.activeCategory() === id ? null : id);
  }

  protected toggleDiet(diet: DietTag): void {
    this.activeDiets.update((current) =>
      current.includes(diet) ? current.filter((item) => item !== diet) : [...current, diet],
    );
  }

  /** Clears only the diet filters; the chosen category stays put. */
  protected clearDiets(): void {
    this.activeDiets.set([]);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clearFilters(): void {
    this.activeCategory.set(null);
    this.activeDiets.set([]);
    this.search.set('');
  }

  /** Si la mesa ya mandó algo a la cocina, aunque el carrito esté vacío. */
  protected readonly tableHasConsumed = computed(
    () => (this.session.session()?.placedTotal?.amountInMinorUnits ?? 0) > 0,
  );

  protected readonly sharedCount = computed(() => {
    const current = this.session.session();
    if (current === null) return this.cart.count();
    return current.lines.reduce((total, line) => total + line.quantity, 0);
  });

  /**
   * Lo que la mesa lleva consumido: el carrito más lo ya enviado a la cocina.
   *
   * Antes sumaba sólo el carrito, así que apenas la mesa mandaba el pedido el
   * pie mostraba $0 — justo cuando más plata debe. Carrito vacío no es mesa
   * sin consumo.
   */
  protected readonly sharedTotalLabel = computed(() => {
    const current = this.session.session();
    if (current === null) return this.cart.total().toString();

    const enCarrito = current.subtotals.reduce(
      (total, entry) => total + entry.subtotal.amountInMinorUnits,
      0,
    );
    const minor = enCarrito + (current.placedTotal?.amountInMinorUnits ?? 0);
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: current.currency,
      maximumFractionDigits: 0,
    }).format(minor / 100);
  });

  protected dinerColor(index: number): string {
    return DINER_PALETTE[index % DINER_PALETTE.length] ?? DINER_PALETTE[0];
  }

  /** Widths the browser picks from; 80px covers the list thumbnail on 1x. */
  protected srcset(set: NonNullable<Product['images']>, format: string): string {
    return set.variants
      .filter((variant) => variant.format === format)
      .map((variant) => `${variant.url} ${variant.width}w`)
      .join(', ');
  }

  protected fallback(set: NonNullable<Product['images']>): string {
    const jpeg = set.variants.filter((variant) => variant.format === 'jpeg');
    return jpeg.find((variant) => variant.width === 300)?.url ?? jpeg[0]?.url ?? '';
  }

  /** Visible products grouped under their category, in carte order. */
  protected readonly sections = computed(() => {
    const products = this.visibleProducts();

    return this.categories()
      .map((category) => ({
        id: category.id,
        name: category.name,
        products: products.filter((product) => product.categoryId === category.id),
      }))
      .filter((section) => section.products.length > 0);
  });

  /**
   * Sentence case for display only; the stored name is left untouched so the
   * kitchen ticket and the bill still read exactly what was typed.
   */
  protected display(text: string): string {
    const trimmed = text.trim();
    if (trimmed === '') return trimmed;
    return trimmed.charAt(0).toLocaleUpperCase('es-AR') + trimmed.slice(1);
  }

  protected dietLabel(diet: DietTag): string {
    return DIET_LABELS.find((entry) => entry.tag === diet)?.label ?? diet;
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase();
  }
}
