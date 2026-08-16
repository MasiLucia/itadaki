import { apiUrl } from '@itadaki/shared/domain';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { type ImageEditParams } from '@itadaki/catalog/domain';
import { ImageEditorComponent } from '@itadaki/shared/ui-image-editor';
import { AuthStore, LoginComponent } from '@itadaki/shared/ui-auth';
import { QrSheetComponent } from './qr-sheet.component';
import { MetricsComponent } from './metrics.component';

/**
 * Las tres cosas distintas que hace un dueño acá.
 *
 * Estaban las tres en la misma página, una debajo de otra: la carta entera,
 * el editor de fotos, el equipo, las mesas. Había que scrollear todo para
 * llegar a cualquier cosa, y nada indicaba dónde ir para cada tarea.
 */
type AdminTab = 'carta' | 'fotos' | 'local';

const TABS: ReadonlyArray<{ id: AdminTab; label: string; hint: string }> = [
  { id: 'carta', label: 'Tu carta', hint: 'platos y categorías' },
  { id: 'fotos', label: 'Fotos', hint: 'encuadrar y publicar' },
  { id: 'local', label: 'Tu local', hint: 'mesas, equipo y ventas' },
];

const API = apiUrl();

interface MenuProduct {
  id: string;
  name: string;
  description: string;
  categoryId: string;
  price: { amountInMinorUnits: number; currency: string };
  available: boolean;
  imageSet: { variants: Array<{ url: string; width: number; format: string }>; lqip: string } | null;
}

interface MenuCategory {
  id: string;
  name: string;
}

interface RestaurantTable {
  id: string;
  label: string;
  seats: number;
  url: string;
}

interface StaffMember {
  id: string;
  email: string;
  displayName: string;
  role: string;
  active: boolean;
}

const ROLE_NAMES: Record<string, string> = {
  OWNER: 'Dueño',
  MANAGER: 'Encargado',
  KITCHEN: 'Cocina',
  WAITER: 'Mozo',
};

@Component({
  selector: 'itd-admin',
  standalone: true,
  imports: [ImageEditorComponent, LoginComponent, QrSheetComponent, MetricsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin.component.css',
  template: `
    @if (!auth.ready()) {
      <p class="booting">Cargando…</p>
    } @else if (!auth.signedIn()) {
      <itd-login context="Administración" />
    } @else if (showQrSheet()) {
      <!-- Full screen: the print layout must own the page for @media print. -->
      <itd-qr-sheet [tables]="tables()" (close)="showQrSheet.set(false)" />
    } @else {
    <header class="head">
      <div>
        <p class="eyebrow">Administración</p>
        <h1 class="title">{{ tabTitle() }}</h1>
      </div>
      <div class="session">
        <span class="who">
          {{ auth.profile()?.displayName }}
          <em>{{ roleLabel() }}</em>
        </span>
        <button type="button" class="signout" (click)="auth.signOut()">Salir</button>
      </div>
    </header>

    <!-- Tres solapas en vez de una columna infinita.
         Antes la carta entera, el equipo, las mesas y el editor de fotos
         vivían apilados en la misma página: había que scrollear todo para
         llegar a cualquier cosa, y no se veía dónde ir para cada tarea. -->
    <nav class="tabs" aria-label="Secciones">
      @for (tab of tabs; track tab.id) {
        @if (canSee(tab.id)) {
          <button
            type="button"
            class="tab"
            [class.on]="activeTab() === tab.id"
            [attr.aria-current]="activeTab() === tab.id ? 'page' : null"
            (click)="activeTab.set(tab.id)"
          >
            <span class="tab-name">{{ tab.label }}</span>
            <span class="tab-hint">{{ tab.hint }}</span>
          </button>
        }
      }
    </nav>

    @if (trial(); as sub) {
      @if (sub.status === 'EXPIRED') {
        <section class="trial expired" role="alert">
          <strong>Se terminó tu mes de prueba.</strong>
          <span>
            Los comensales siguen pidiendo y la cocina sigue recibiendo, pero no
            podés cambiar la carta ni las mesas hasta que activemos tu cuenta.
            Escribinos y lo resolvemos.
          </span>
        </section>
      } @else if (sub.status === 'TRIAL_ENDING') {
        <section class="trial ending" role="status">
          <strong>
            Te {{ sub.daysLeft === 1 ? 'queda' : 'quedan' }} {{ sub.daysLeft }}
            {{ sub.daysLeft === 1 ? 'día' : 'días' }} de prueba.
          </strong>
          <span>Escribinos para seguir usándolo sin interrupciones.</span>
        </section>
      }
    }

    <!-- Only while something is genuinely missing: a checklist that never goes
         away stops being guidance and becomes clutter. -->
    @if (setupSteps().length > 0) {
      <section class="setup" aria-labelledby="setup-title">
        <h2 class="setup-title" id="setup-title">Para empezar</h2>
        <p class="setup-lede">
          Tres pasos y tu carta ya funciona en las mesas.
        </p>
        <ol class="setup-steps">
          @for (step of setupSteps(); track step.id) {
            <li class="setup-step" [class.done]="step.done">
              <span class="setup-mark" aria-hidden="true">{{ step.done ? '✓' : step.n }}</span>
              <span class="setup-text">
                <span class="setup-name">{{ step.title }}</span>
                <span class="setup-hint">{{ step.hint }}</span>
              </span>
            </li>
          }
        </ol>
      </section>
    }

    <div class="layout" [attr.data-tab]="activeTab()">

      <!-- Tu carta: los platos y cómo se organizan. -->
      @if (activeTab() === 'carta') {
      <section class="panel">
        <h2 class="panel-title">Tus platos</h2>
        <div class="products">
          @for (product of products(); track product.id) {
            <button
              type="button"
              class="product"
              [attr.aria-pressed]="selected() === product.id"
              (click)="select(product.id)"
            >
              @if (thumb(product); as url) {
                <img class="product-thumb" [src]="url" alt="" width="56" height="56" />
              } @else {
                <span class="product-thumb empty" aria-hidden="true">
                  {{ initials(product.name) }}
                </span>
              }

              <span class="product-info">
                <span class="product-name">{{ product.name }}</span>
                <span class="product-meta">
                  <span class="product-price">{{ format(product.price) }}</span>
                  @if (!product.available) {
                    <span class="badge out">sin stock</span>
                  }
                </span>
              </span>
            </button>
          } @empty {
            <p class="muted">cargando la carta…</p>
          }
        </div>

        <details class="details manage-cats">
          <summary>organizar categorías</summary>

          <div class="cat-list">
            @for (category of categories(); track category.id) {
              <div class="cat-row">
                <input
                  class="cat-name"
                  [value]="category.name"
                  maxlength="40"
                  [attr.aria-label]="'Nombre de ' + category.name"
                  (blur)="renameCategory(category.id, $event)"
                />
                <span class="cat-count">{{ countIn(category.id) }}</span>
                <button
                  type="button"
                  class="cat-move"
                  [disabled]="$first"
                  aria-label="Subir"
                  (click)="moveCategory(category.id, -1)"
                >↑</button>
                <button
                  type="button"
                  class="cat-move"
                  [disabled]="$last"
                  aria-label="Bajar"
                  (click)="moveCategory(category.id, 1)"
                >↓</button>
                <button
                  type="button"
                  class="cat-del"
                  [disabled]="countIn(category.id) > 0"
                  [attr.title]="countIn(category.id) > 0 ? 'primero movés sus platos' : 'eliminar'"
                  aria-label="Eliminar categoría"
                  (click)="deleteCategory(category.id)"
                >×</button>
              </div>
            }
          </div>

          <form class="new-form" (submit)="createCategory($event)">
            <label class="field">
              <span>nueva categoría</span>
              <input name="name" required maxlength="40" placeholder="ej: parrilla, entradas, vinos" />
            </label>
            <button type="submit" class="create">crear categoría</button>
          </form>

          @if (catError(); as error) {
            <p class="status error">{{ error }}</p>
          }
        </details>

        <!-- Abierto, no plegado.
             Escondido detrás de un resumen, alguien lo llenaba, lo cerraba y
             se quedaba sin saber si el plato se había guardado. -->
        <details class="details new-dish" open>
          <summary>+ agregar un plato nuevo</summary>
          <form class="new-form" (submit)="createProduct($event)">
            <label class="field">
              <span>nombre</span>
              <input name="name" required maxlength="60" placeholder="ej: gyoza de cerdo" />
            </label>
            <label class="field">
              <span>descripción</span>
              <input name="description" maxlength="140" placeholder="ej: seis unidades, salsa ponzu" />
            </label>
            <label class="field">
              <span>precio en pesos</span>
              <!-- step=1: a price is whatever the restaurant charges, not a
                   multiple of a hundred. -->
              <input name="price" type="number" min="0" step="1" required placeholder="4500" />
            </label>
            <label class="field">
              <span>categoría</span>
              <select name="categoryId">
                @for (category of categories(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </select>
            </label>
            <button type="submit" class="create">crear plato</button>
            @if (createError(); as error) {
              <p class="status error">{{ error }}</p>
            }
            @if (createdName(); as name) {
              <!-- El plato ya está guardado; la foto es opcional y va después.
                   Decirlo acá evita que alguien crea que faltó algo. -->
              <p class="status created" role="status">
                <strong>{{ name }}</strong> ya está en tu carta ✓
              </p>
            }
          </form>
        </details>
      </section>
      }

      <!-- Fotos: en su propia solapa, para que el editor no empuje la carta. -->
      @if (activeTab() === 'fotos') {
      <section class="panel">
        <h2 class="panel-title">Encuadrá y ajustá el foco</h2>
        @if (selected() === null) {
          <!-- Sin plato elegido esta solapa no tiene nada que hacer, así que
               manda de vuelta a donde se elige en vez de dejar un cartel. -->
          <p class="muted">Elegí un plato de tu carta para subirle una foto.</p>
          <button type="button" class="secondary" (click)="activeTab.set('carta')">
            Ver mi carta →
          </button>
        } @else {
          <div class="editing-bar">
            <p class="editing-for">
              editando <strong>{{ selectedName() }}</strong>
            </p>
            <label class="cat-picker">
              <span>categoría</span>
              <select [value]="selectedCategory()" (change)="moveProduct($event)">
                @for (category of categories(); track category.id) {
                  <option [value]="category.id">{{ category.name }}</option>
                }
              </select>
            </label>

            <!-- Prices change constantly; editing one should not mean deleting
                 the dish and creating it again. -->
            <label class="price-picker">
              <span>precio</span>
              <input
                type="number"
                min="0"
                step="1"
                [value]="selectedPricePesos()"
                (change)="changePrice($event)"
              />
              @if (priceSaved()) {
                <span class="price-saved" role="status">guardado</span>
              }
            </label>
          </div>
          <itd-image-editor
            [subjectId]="selected()!"
            [existingUrl]="currentPhoto()"
            (applied)="upload($event)"
          />
        }
      </section>
      <section class="panel">
        <h2 class="panel-title">Así se va a ver</h2>
        @if (status(); as state) {
          <p class="status" [class.error]="state.startsWith('error')">{{ state }}</p>
        }
        @if (result(); as set) {
          <img class="preview" [src]="best(set)" alt="" width="300" height="300" />
          <p class="muted">{{ set.variants.length }} variantes · AVIF, WebP y JPEG en 4 tamaños</p>
          <details class="details">
            <summary>ver URLs generadas</summary>
            <ul>
              @for (variant of set.variants; track variant.url) {
                <li>{{ variant.width }}px · {{ variant.format }}</li>
              }
            </ul>
          </details>
        }
      </section>
      }

      <!-- Tu local: mesas, equipo y ventas. -->
      @if (activeTab() === 'local') {
      <section class="panel">
        <h2 class="panel-title">Mesas y equipo</h2>
        <details class="details manage-tables">
          <summary>Mesas y códigos QR</summary>

          <div class="table-list">
            @for (table of tables(); track table.id) {
              <div class="table-row">
                <div class="table-info">
                  <span class="table-label">{{ table.label }}</span>
                  <span class="table-seats">{{ table.seats }} lugares</span>
                </div>
                <div class="table-actions">
                  <button type="button" class="table-copy" (click)="copyLink(table)">
                    {{ copied() === table.id ? '¡Copiado!' : 'Copiar link' }}
                  </button>
                  <button
                    type="button"
                    class="table-rotate"
                    (click)="rotate(table)"
                    title="Invalida los QR ya impresos de esta mesa"
                  >
                    Renovar QR
                  </button>
                </div>
              </div>
            } @empty {
              <p class="muted">Todavía no cargaste ninguna mesa.</p>
            }
          </div>

          @if (tables().length > 0) {
            <button type="button" class="print-all" (click)="showQrSheet.set(true)">
              Ver e imprimir los QR ({{ tables().length }})
            </button>
          }

          <form class="new-form" (submit)="createTable($event)">
            <label class="field">
              <span>Nueva mesa</span>
              <input name="label" required maxlength="40" placeholder="Ej: Mesa 8, Barra 2" />
            </label>
            <button type="submit" class="create">Crear mesa</button>
          </form>
          <p class="muted qr-hint">
            El link es el QR de esa mesa. Vence a las 8 horas y se renueva solo cada vez que abrís esta pantalla.
          </p>
        </details>

        @if (auth.can('staff:manage')) {
          <details class="details manage-staff">
            <summary>Tu equipo</summary>

            <div class="staff-list">
              @for (member of staff(); track member.id) {
                <div class="staff-row" [class.inactive]="!member.active">
                  <div class="staff-info">
                    <span class="staff-name">{{ member.displayName }}</span>
                    <span class="staff-meta">
                      {{ roleName(member.role) }} · {{ member.email }}
                    </span>
                  </div>
                  @if (member.id === auth.profile()?.id) {
                    <span class="staff-you">vos</span>
                  } @else {
                    <button
                      type="button"
                      class="staff-toggle"
                      (click)="toggleStaff(member)"
                    >
                      {{ member.active ? 'Dar de baja' : 'Reactivar' }}
                    </button>
                  }
                </div>
              } @empty {
                <p class="muted">Todavía sos la única persona con acceso.</p>
              }
            </div>

            <form class="new-form staff-form" (submit)="inviteStaff($event)">
              <label class="field">
                <span>Nombre</span>
                <input name="displayName" required maxlength="60" placeholder="Ej: Nico" />
              </label>
              <label class="field">
                <span>Email</span>
                <input name="email" type="email" required placeholder="nico@turestaurante.ar" />
              </label>
              <label class="field">
                <span>Contraseña inicial</span>
                <input name="password" type="password" required minlength="8" />
              </label>
              <label class="field">
                <span>Puesto</span>
                <select name="role" required>
                  <option value="KITCHEN">Cocina — ve y avanza los pedidos</option>
                  <option value="WAITER">Mozo — pedidos y cuentas</option>
                  <option value="MANAGER">Encargado — todo menos el equipo</option>
                </select>
              </label>
              <button type="submit" class="create">Dar de alta</button>
            </form>

            @if (staffError(); as message) {
              <p class="error-note" role="alert">{{ message }}</p>
            }
            <p class="muted qr-hint">
              Le pasás vos la contraseña; después la puede seguir usando para entrar.
            </p>
          </details>
        }

      </section>

      @if (auth.can('metrics:read')) {
        <section class="panel">
          <h2 class="panel-title">Ventas</h2>
          <itd-metrics [apiUrl]="apiUrl" />
        </section>
      }
      }
    </div>
    }
  `,
})
export class AdminComponent {
  protected readonly auth = inject(AuthStore);

  protected readonly tabs = TABS;
  protected readonly activeTab = signal<AdminTab>('carta');

  protected tabTitle(): string {
    return TABS.find((tab) => tab.id === this.activeTab())?.label ?? 'Administración';
  }

  /** El equipo y las ventas sólo los ve quien tiene permiso. */
  protected canSee(tab: AdminTab): boolean {
    if (tab !== 'local') return true;
    return this.auth.can('staff:manage') || this.auth.can('metrics:read');
  }

  protected readonly products = signal<readonly MenuProduct[]>([]);
  protected readonly categories = signal<readonly MenuCategory[]>([]);
  protected readonly createError = signal<string | null>(null);
  protected readonly createdName = signal<string | null>(null);
  protected readonly tables = signal<readonly RestaurantTable[]>([]);
  protected readonly copied = signal<string | null>(null);
  protected readonly showQrSheet = signal(false);
  protected readonly apiUrl = API;
  protected readonly staff = signal<readonly StaffMember[]>([]);
  protected readonly staffError = signal<string | null>(null);
  protected readonly trial = signal<{
    status: string;
    daysLeft: number | null;
  } | null>(null);
  protected readonly catError = signal<string | null>(null);
  /** Bumped after every upload to bust the browser's image cache. */
  private readonly photoVersion = signal(0);
  protected readonly selected = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);
  protected readonly result = signal<{ variants: Array<{ url: string; width: number; format: string }>; lqip: string } | null>(null);

  constructor() {
    this.auth.configure(API);
    void this.auth.restore().then(() => {
      if (this.auth.signedIn()) void this.load();
    });

    // Reload the carte whenever a sign-in completes.
    effect(() => {
      if (this.auth.signedIn()) void this.load();
    });
  }

  protected roleLabel(): string {
    const labels: Record<string, string> = {
      OWNER: 'Dueño',
      MANAGER: 'Encargado',
      KITCHEN: 'Cocina',
      WAITER: 'Mozo',
    };
    return labels[this.auth.profile()?.role ?? ''] ?? '';
  }

  private async load(): Promise<void> {
    const response = await this.auth.apiFetch(`${API}/menu`, { headers: this.auth.headers() });
    if (!response.ok) return;

    const menu = (await response.json()) as {
      products: MenuProduct[];
      categories: MenuCategory[];
    };
    this.products.set([...menu.products].sort((a, b) => a.name.localeCompare(b.name, 'es')));
    this.categories.set(menu.categories);
    await this.loadTables();
    await this.loadStaff();
    await this.loadTrial();
  }

  private async loadTables(): Promise<void> {
    const response = await this.auth.apiFetch(`${API}/tables`, { headers: this.auth.headers() });
    if (response.ok) {
      this.tables.set((await response.json()) as RestaurantTable[]);
    }
  }

  protected async createTable(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const label = String(new FormData(form).get('label') ?? '').trim();
    if (label === '') return;

    const response = await this.auth.apiFetch(`${API}/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({ label }),
    });

    if (response.ok) {
      form.reset();
      await this.loadTables();
    }
  }

  /**
   * First-run guidance, derived from what the restaurant actually has.
   *
   * A fresh panel is every section empty at once, which reads as broken rather
   * than new. The list disappears on its own once the three things that make
   * the app usable exist, so nobody has to dismiss it.
   */
  protected readonly setupSteps = computed(() => {
    const steps = [
      {
        id: 'categories',
        n: 1,
        title: 'Creá tus categorías',
        hint: 'Entradas, principales, postres… las secciones de tu carta.',
        done: this.categories().length > 0,
      },
      {
        id: 'products',
        n: 2,
        title: 'Cargá tus platos',
        hint: 'Con nombre y precio ya alcanza; las fotos podés sumarlas después.',
        done: this.products().length > 0,
      },
      {
        id: 'tables',
        n: 3,
        title: 'Sumá tus mesas e imprimí los QR',
        hint: 'Cada mesa tiene su código; se imprimen todos juntos.',
        done: this.tables().length > 0,
      },
    ];

    return steps.every((step) => step.done) ? [] : steps;
  });

  protected readonly priceSaved = signal(false);

  /** The selected dish's price in pesos, for the editable field. */
  protected selectedPricePesos(): number {
    const product = this.products().find((candidate) => candidate.id === this.selected());
    return product === undefined ? 0 : Math.round(product.price.amountInMinorUnits / 100);
  }

  /**
   * Saves a new price for the selected dish.
   *
   * Orders already placed keep the price they were taken at — the snapshot in
   * the order is the contract with that diner, and this does not touch it.
   */
  protected async changePrice(event: Event): Promise<void> {
    const productId = this.selected();
    if (productId === null) return;

    const pesos = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(pesos) || pesos < 0) return;

    const response = await this.auth.apiFetch(`${API}/menu/products/${productId}`, {
      method: 'PATCH',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceMinor: Math.round(pesos * 100) }),
    });

    if (response.ok) {
      await this.load();
      this.priceSaved.set(true);
      globalThis.setTimeout(() => this.priceSaved.set(false), 1600);
    }
  }

  protected roleName(role: string): string {
    return ROLE_NAMES[role] ?? role;
  }

  private async loadTrial(): Promise<void> {
    const response = await this.auth.apiFetch(`${API}/auth/subscription`, { headers: this.auth.headers() });
    if (response.ok) {
      this.trial.set((await response.json()) as { status: string; daysLeft: number | null });
    }
  }

  private async loadStaff(): Promise<void> {
    if (!this.auth.can('staff:manage')) return;

    const response = await this.auth.apiFetch(`${API}/staff`, { headers: this.auth.headers() });
    if (response.ok) {
      this.staff.set((await response.json()) as StaffMember[]);
    }
  }

  protected async inviteStaff(event: Event): Promise<void> {
    event.preventDefault();
    this.staffError.set(null);

    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const payload = {
      displayName: String(data.get('displayName') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
      role: String(data.get('role') ?? 'KITCHEN'),
    };
    if (payload.displayName === '' || payload.email === '' || payload.password === '') return;

    const response = await this.auth.apiFetch(`${API}/staff`, {
      method: 'POST',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { kind?: string } | null;
      this.staffError.set(
        detail?.kind === 'EMAIL_TAKEN'
          ? 'Ya existe una cuenta con ese email'
          : detail?.kind === 'PASSWORD_TOO_SHORT'
            ? 'La contraseña necesita al menos 8 caracteres'
            : detail?.kind === 'INVALID_EMAIL'
              ? 'Revisá el email'
              : 'No pudimos dar de alta a esa persona',
      );
      return;
    }

    form.reset();
    await this.loadStaff();
  }

  /** Revoking access is reversible, so it confirms but does not alarm. */
  protected async toggleStaff(member: StaffMember): Promise<void> {
    if (member.active) {
      const ok = globalThis.confirm(
        `Dar de baja a ${member.displayName}?\n\nNo va a poder entrar hasta que lo reactives.`,
      );
      if (!ok) return;
    }

    const response = await this.auth.apiFetch(`${API}/staff/${member.id}/active`, {
      method: 'PATCH',
      headers: { ...this.auth.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !member.active }),
    });
    if (response.ok) await this.loadStaff();
  }

  /**
   * Rotates a table's secret, which invalidates every QR already printed for
   * it — the reason to do that is a leaked or photographed code, so it asks
   * first and says plainly what breaks.
   */
  protected async rotate(table: RestaurantTable): Promise<void> {
    const ok = globalThis.confirm(
      `Renovar el QR de ${table.label}?\n\n` +
        'Los códigos ya impresos de esta mesa dejan de funcionar y hay que imprimirlos de nuevo.',
    );
    if (!ok) return;

    const response = await this.auth.apiFetch(`${API}/tables/${table.id}/rotate`, {
      method: 'POST',
      headers: this.auth.headers(),
    });
    if (response.ok) await this.loadTables();
  }

  /** Copies the QR link so it can be pasted into a code generator or printed. */
  protected async copyLink(table: RestaurantTable): Promise<void> {
    try {
      await navigator.clipboard.writeText(table.url);
      this.copied.set(table.id);
      globalThis.setTimeout(() => this.copied.set(null), 2000);
    } catch {
      // Clipboard blocked: leave the label unchanged rather than lie.
    }
  }

  /** Largest webp of the selected dish, used as the editor's opening image. */
  protected currentPhoto(): string | null {
    const set = this.result();
    if (set === null) return null;

    const webp = set.variants.filter((variant) => variant.format === 'webp');
    return webp.find((variant) => variant.width === 600)?.url ?? webp[0]?.url ?? null;
  }

  protected countIn(categoryId: string): number {
    return this.products().filter((product) => product.categoryId === categoryId).length;
  }

  protected selectedCategory(): string {
    return this.products().find((product) => product.id === this.selected())?.categoryId ?? '';
  }

  protected async createCategory(event: Event): Promise<void> {
    event.preventDefault();
    this.catError.set(null);

    const form = event.target as HTMLFormElement;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (name === '') return;

    const response = await this.auth.apiFetch(`${API}/menu/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      this.catError.set('no pudimos crear la categoría');
      return;
    }
    form.reset();
    await this.load();
  }

  protected async renameCategory(categoryId: string, event: Event): Promise<void> {
    const name = (event.target as HTMLInputElement).value.trim();
    const current = this.categories().find((category) => category.id === categoryId);
    if (name === '' || current === undefined || name === current.name) return;

    const response = await this.auth.apiFetch(`${API}/menu/categories/${categoryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      this.catError.set('no pudimos renombrar la categoría');
      return;
    }
    await this.load();
  }

  protected async moveCategory(categoryId: string, delta: number): Promise<void> {
    const order = this.categories().map((category) => category.id);
    const from = order.indexOf(categoryId);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= order.length) return;

    const reordered = [...order];
    const [moved] = reordered.splice(from, 1);
    if (moved !== undefined) reordered.splice(to, 0, moved);

    await this.auth.apiFetch(`${API}/menu/categories/reorder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({ orderedIds: reordered }),
    });
    await this.load();
  }

  protected async deleteCategory(categoryId: string): Promise<void> {
    this.catError.set(null);

    const response = await this.auth.apiFetch(`${API}/menu/categories/${categoryId}`, {
      method: 'DELETE',
      headers: this.auth.headers(),
    });
    if (!response.ok) {
      this.catError.set('esa categoría todavía tiene platos');
      return;
    }
    await this.load();
  }

  /** Moves the selected dish to another category. */
  protected async moveProduct(event: Event): Promise<void> {
    const productId = this.selected();
    if (productId === null) return;

    const categoryId = (event.target as HTMLSelectElement).value;
    const response = await this.auth.apiFetch(`${API}/menu/products/${productId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({ categoryId }),
    });

    if (response.ok) await this.load();
  }

  protected selectedName(): string {
    return this.products().find((product) => product.id === this.selected())?.name ?? '';
  }

  /** Smallest variant is plenty for a 56px row thumbnail. */
  protected thumb(product: MenuProduct): string | null {
    const variants = product.imageSet?.variants ?? [];
    const webp = variants.filter((variant) => variant.format === 'webp');
    const url = webp.find((variant) => variant.width === 80)?.url ?? webp[0]?.url ?? null;
    if (url === null) return null;

    const version = this.photoVersion();
    if (version === 0) return url;
    return `${url}${url.includes('?') ? '&' : '?'}v=${version}`;
  }

  protected initials(name: string): string {
    return name
      .split(' ')
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase();
  }

  protected async createProduct(event: Event): Promise<void> {
    event.preventDefault();
    this.createError.set(null);

    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    const pesos = Number(data.get('price'));

    if (!Number.isFinite(pesos) || pesos < 0) {
      this.createError.set('el precio no es válido');
      return;
    }

    const response = await this.auth.apiFetch(`${API}/menu/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({
        name: String(data.get('name') ?? '').trim(),
        description: String(data.get('description') ?? '').trim(),
        // The form takes pesos; the domain stores integer minor units.
        priceMinor: Math.round(pesos * 100),
        categoryId: String(data.get('categoryId') ?? ''),
      }),
    });

    if (!response.ok) {
      // The API says which field it rejected; repeating "no pudimos" for
      // everything left people guessing what to change.
      const detail = (await response.json().catch(() => null)) as
        | { message?: unknown; kind?: string }
        | null;
      const issues = Array.isArray(detail) ? detail : (detail?.message ?? null);
      const first = Array.isArray(issues)
        ? (issues[0] as { path?: string[] } | undefined)?.path?.[0]
        : undefined;

      this.createError.set(
        first === 'categoryId'
          ? 'Elegí una categoría para el plato'
          : first === 'name'
            ? 'Poné un nombre para el plato'
            : first === 'priceMinor'
              ? 'Revisá el precio'
              : 'No pudimos crear el plato',
      );
      return;
    }

    const created = (await response.json()) as { id?: string; name?: string };
    form.reset();
    await this.load();

    // Creating a dish and photographing it is one task, so the new dish is
    // selected straight away and the editor opens on it. Without this the
    // owner had to hunt for it in the list to add a picture.
    if (created.id !== undefined) {
      this.select(created.id);
    }

    // The dish lands at the top of a list the form has scrolled past, so
    // without a word here it reads as if nothing happened.
    this.createdName.set(created.name ?? 'El plato');
    globalThis.setTimeout(() => this.createdName.set(null), 4000);
  }

  protected select(id: string): void {
    this.selected.set(id);
    this.status.set(null);

    // Elegir un plato es el paso previo a trabajar su foto, así que la solapa
    // acompaña: sin esto había que elegir acá y después buscar dónde seguir.
    this.activeTab.set('fotos');

    // Show the dish's current photo, if it has one, instead of whatever the
    // previous upload left on screen.
    const existing = this.products().find((product) => product.id === id)?.imageSet ?? null;
    this.result.set(existing);
  }

  protected format(price: { amountInMinorUnits: number; currency: string }): string {
    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: price.currency,
      maximumFractionDigits: 0,
    }).format(price.amountInMinorUnits / 100);
  }

  protected best(set: { variants: Array<{ url: string; width: number; format: string }> }): string {
    return set.variants.find((v) => v.width === 300 && v.format === 'webp')?.url ?? '';
  }

  /** Sends the original plus the parameters — never a rasterised canvas. */
  protected async upload(event: { params: ImageEditParams; file: File }): Promise<void> {
    const productId = this.selected();
    if (productId === null) return;

    this.status.set('procesando la imagen…');

    const buffer = await event.file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);

    const response = await this.auth.apiFetch(`${API}/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth.headers() },
      body: JSON.stringify({
        imageId: productId,
        alt: this.products().find((p) => p.id === productId)?.name ?? '',
        data: btoa(binary),
        params: event.params,
      }),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => null)) as { kind?: string } | null;
      this.status.set(
        detail?.kind === 'UNSUPPORTED_TYPE'
          ? 'error: ese archivo no es una imagen válida'
          : 'error: no pudimos procesar la imagen',
      );
      return;
    }

    const created = (await response.json()) as {
      imageSet: { variants: Array<{ url: string; width: number; format: string }>; lqip: string };
    };

    // Variant URLs never change, so the browser would keep serving the
    // previous render from cache. A version marker forces a re-fetch.
    const version = Date.now();
    this.result.set({
      ...created.imageSet,
      variants: created.imageSet.variants.map((variant) => ({
        ...variant,
        url: `${variant.url}${variant.url.includes('?') ? '&' : '?'}v=${version}`,
      })),
    });

    this.status.set('listo · la foto ya está en la carta');
    this.photoVersion.set(version);

    // Re-read the menu so the list on the left shows the new thumbnail.
    await this.load();
  }
}
