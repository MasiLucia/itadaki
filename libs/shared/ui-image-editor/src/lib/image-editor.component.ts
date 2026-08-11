import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  type Adjustments,
  DEFAULT_ADJUSTMENTS,
  type ImageEditParams,
  type LumaGrid,
  proposeFrame,
} from '@itadaki/catalog/domain';

/** Downsample width for saliency analysis; detail beyond this adds cost, not accuracy. */
const ANALYSIS_WIDTH = 160;

/**
 * Square-crop editor with a regulable focal point.
 *
 * The preview is CSS-only: a duplicated layer is blurred and revealed through
 * a radial mask, which stays smooth while dragging. Nothing here rasterises
 * the image — only the parameters are emitted, and the server re-renders from
 * the untouched original.
 */
@Component({
  selector: 'itd-image-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './image-editor.component.css',
  template: `
    <div class="editor">
      @if (sourceUrl(); as url) {
        <div
          class="stage"
          [class.pannable]="canPan()"
          #stage
          (pointerdown)="onPointerDown($event)"
          (pointermove)="onPointerMove($event)"
          (pointerup)="endDrag()"
          (pointercancel)="endDrag()"
          (wheel)="onWheel($event)"
        >
          <img class="layer base" [src]="url" [style.transform]="transform()" alt="" />

          @if (blurIntensity() > 0) {
            <img
              class="layer blur"
              [src]="url"
              [style.transform]="transform()"
              [style.filter]="'blur(' + blurPx() + 'px)'"
              [style.-webkit-mask-image]="maskImage()"
              [style.mask-image]="maskImage()"
              alt=""
            />
          }

          <div class="focal" [style.left.%]="focalX() * 100" [style.top.%]="focalY() * 100">
            <span class="focal-ring" [style.width.px]="ringSize()" [style.height.px]="ringSize()"></span>
          </div>

          <div class="grid" aria-hidden="true"></div>
        </div>

        <div class="modes" role="group" aria-label="Modo de edición">
          <button
            type="button"
            class="mode"
            [attr.aria-pressed]="mode() === 'frame'"
            (click)="setMode('frame')"
          >
            encuadrar
          </button>
          <button
            type="button"
            class="mode"
            [attr.aria-pressed]="mode() === 'focus'"
            (click)="setMode('focus')"
          >
            punto de foco
          </button>
        </div>

        @if (showingExisting()) {
          <p class="existing-note" role="status">
            foto actual de este plato · elegí otra para reemplazarla
          </p>
        } @else if (autoFramed()) {
          <p class="auto-note" role="status">encuadre sugerido automáticamente · movelo si querés</p>
        }
        <p class="hint">
          @if (mode() === 'frame') {
            @if (canPan()) {
              arrastrá la foto para encuadrarla · rueda o pellizco para zoom
            } @else {
              hacé zoom para poder mover el encuadre
            }
          } @else {
            tocá donde querés que quede nítido
          }
        </p>

        <div class="controls">
          <label class="control">
            <span class="control-label">zoom <b>{{ zoom().toFixed(2) }}×</b></span>
            <input
              type="range" min="1" max="4" step="0.01"
              [value]="zoom()" (input)="setZoom($event)"
            />
          </label>

          <label class="control">
            <span class="control-label">radio de nitidez <b>{{ percent(sharpRadius()) }}%</b></span>
            <input
              type="range" min="0" max="1" step="0.01"
              [value]="sharpRadius()" (input)="setSharpRadius($event)"
            />
          </label>

          <label class="control">
            <span class="control-label">desenfoque <b>{{ percent(blurIntensity()) }}%</b></span>
            <input
              type="range" min="0" max="1" step="0.01"
              [value]="blurIntensity()" (input)="setBlurIntensity($event)"
            />
          </label>

          <label class="control">
            <span class="control-label">nitidez <b>{{ sharpen().toFixed(1) }}</b></span>
            <input
              type="range" min="0" max="3" step="0.1"
              [value]="sharpen()" (input)="setSharpen($event)"
            />
          </label>

          <label class="control">
            <span class="control-label">brillo <b>{{ brightness().toFixed(2) }}</b></span>
            <input
              type="range" min="0.5" max="1.5" step="0.01"
              [value]="brightness()" (input)="setBrightness($event)"
            />
          </label>

          <label class="control">
            <span class="control-label">saturación <b>{{ saturation().toFixed(2) }}</b></span>
            <input
              type="range" min="0" max="2" step="0.01"
              [value]="saturation()" (input)="setSaturation($event)"
            />
          </label>
        </div>

        <div class="actions">
          <label class="ghost file-swap">
            {{ showingExisting() ? 'subir otra foto' : 'cambiar foto' }}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              (change)="onFile($event)"
            />
          </label>
          <button type="button" class="ghost" (click)="reset()">restablecer</button>
          <button type="button" class="primary" [disabled]="showingExisting()" (click)="emit()">
            aplicar recorte
          </button>
        </div>
      } @else {
        <label class="dropzone">
          <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" (change)="onFile($event)" />
          <span class="dropzone-title">elegí una foto</span>
          <span class="dropzone-hint">JPG, PNG, WebP o AVIF · hasta 15 MB</span>
        </label>
      }
    </div>
  `,
})
export class ImageEditorComponent {
  /** Changing this clears the editor: a new dish must not inherit the last photo. */
  readonly subjectId = input<string>('');

  /** Photo the subject already has, shown so the editor opens on real content. */
  readonly existingUrl = input<string | null>(null);

  readonly applied = output<{ params: ImageEditParams; file: File }>();

  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  protected readonly sourceUrl = signal<string | null>(null);
  protected readonly autoFramed = signal(false);
  /** True while showing the stored photo: applying needs a fresh file. */
  protected readonly showingExisting = signal(false);
  /** Natural aspect ratio of the loaded photo; drives how far it can pan. */
  private readonly aspect = signal(1);

  /**
   * Dragging and setting the focal point competed for the same gesture, so a
   * drag that barely moved silently became a focus tap. An explicit mode makes
   * each gesture do one thing.
   */
  protected readonly mode = signal<'frame' | 'focus'>('frame');
  protected readonly zoom = signal(1);
  protected readonly offsetX = signal(0);
  protected readonly offsetY = signal(0);
  protected readonly focalX = signal(0.5);
  protected readonly focalY = signal(0.5);
  protected readonly sharpRadius = signal(0.4);
  protected readonly blurIntensity = signal(0);
  protected readonly sharpen = signal(0);
  protected readonly brightness = signal(1);
  protected readonly saturation = signal(1);

  private file: File | null = null;
  private objectUrl: string | null = null;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  protected readonly transform = computed(
    () => `translate(${this.offsetX()}%, ${this.offsetY()}%) scale(${this.zoom()})`,
  );

  protected readonly blurPx = computed(() => (this.blurIntensity() * 22).toFixed(1));

  protected readonly ringSize = computed(() => Math.max(24, this.sharpRadius() * 320));

  /**
   * How far the photo may travel, in percent of the stage, per axis.
   *
   * The stage is square and the image is `object-fit: cover`, so a landscape
   * photo already overflows sideways before any zoom is applied. Deriving the
   * limit from zoom alone pinned the image at zoom 1 — there was real overflow
   * to explore and dragging did nothing.
   */
  private readonly panLimits = computed(() => {
    const ratio = this.aspect();
    const zoom = this.zoom();

    // Cover scales the shorter side to fill; the longer side overflows.
    const coveredWidth = ratio >= 1 ? ratio : 1;
    const coveredHeight = ratio >= 1 ? 1 : 1 / ratio;

    return {
      x: Math.max(0, (coveredWidth * zoom - 1) * 50),
      y: Math.max(0, (coveredHeight * zoom - 1) * 50),
    };
  });

  /** True when there is somewhere to drag to; drives the cursor. */
  protected readonly canPan = computed(() => {
    const limits = this.panLimits();
    return limits.x > 0.5 || limits.y > 0.5;
  });

  /** Transparent inside the sharp radius so the crisp layer shows through. */
  protected readonly maskImage = computed(() => {
    const inner = (this.sharpRadius() * 100).toFixed(1);
    const outer = Math.min(100, this.sharpRadius() * 100 + 45).toFixed(1);
    return `radial-gradient(circle at ${(this.focalX() * 100).toFixed(1)}% ${(
      this.focalY() * 100
    ).toFixed(1)}%, transparent ${inner}%, black ${outer}%)`;
  });

  constructor() {
    effect(() => {
      // Depend on both inputs so switching dishes wipes the previous photo
      // and falls back to whatever the new dish already has.
      this.subjectId();
      const existing = this.existingUrl();

      this.clear();
      if (existing !== null && existing !== '') {
        this.sourceUrl.set(existing);
        this.showingExisting.set(true);
        // Stored variants are square, but read it rather than assume.
        void this.readAspect(existing);
      }
    });
  }

  /** Drops the loaded photo and every adjustment. */
  private clear(): void {
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.file = null;
    this.sourceUrl.set(null);
    this.showingExisting.set(false);
    this.aspect.set(1);
    this.reset();
  }

  protected setMode(next: 'frame' | 'focus'): void {
    this.mode.set(next);
  }

  protected percent(value: number): string {
    return Math.round(value * 100).toString();
  }

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0];
    if (picked === undefined) return;

    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
    }

    this.file = picked;
    const url = URL.createObjectURL(picked);
    this.objectUrl = url;
    this.sourceUrl.set(url);
    this.showingExisting.set(false);
    this.reset();
    void this.autoFrame(url);
  }

  /**
   * Proposes an opening crop from the image's own detail, so the editor lands
   * on the dish instead of the tablecloth. The user can still move it.
   */
  private async autoFrame(url: string): Promise<void> {
    const grid = await this.sampleLuma(url);
    if (grid === null) return;

    const { crop, focal } = proposeFrame(grid);

    // The stage shows a centred square; convert the proposed offset into the
    // pan the viewport needs to reveal it.
    const shortest = Math.min(grid.width, grid.height);
    const travelPx = Math.max(grid.width, grid.height) - shortest;

    if (travelPx > 0) {
      const isLandscape = grid.width >= grid.height;
      const offsetPx = (isLandscape ? crop.x * grid.width : crop.y * grid.height) - travelPx / 2;
      const shiftPercent = (-offsetPx / shortest) * 100;

      if (isLandscape) this.offsetX.set(shiftPercent);
      else this.offsetY.set(shiftPercent);
    }

    this.focalX.set(focal.x);
    this.focalY.set(focal.y);
    this.autoFramed.set(true);
  }

  /** Reads a photo's aspect ratio without decoding it for analysis. */
  private async readAspect(url: string): Promise<void> {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;

    try {
      await image.decode();
    } catch {
      return;
    }
    if (image.naturalHeight > 0) {
      this.aspect.set(image.naturalWidth / image.naturalHeight);
    }
  }

  /** Decodes the picked file into a small grayscale grid for analysis. */
  private async sampleLuma(url: string): Promise<LumaGrid | null> {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = url;

    try {
      await image.decode();
    } catch {
      return null;
    }

    if (image.naturalHeight > 0) {
      this.aspect.set(image.naturalWidth / image.naturalHeight);
    }

    const scale = ANALYSIS_WIDTH / Math.max(image.naturalWidth, image.naturalHeight, 1);
    const width = Math.max(1, Math.round(image.naturalWidth * Math.min(1, scale)));
    const height = Math.max(1, Math.round(image.naturalHeight * Math.min(1, scale)));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (context === null) return null;

    context.drawImage(image, 0, 0, width, height);

    let pixels: Uint8ClampedArray;
    try {
      pixels = context.getImageData(0, 0, width, height).data;
    } catch {
      return null;
    }

    const data = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index += 1) {
      const offset = index * 4;
      // Rec. 601 luma: green dominates perceived brightness.
      data[index] = Math.round(
        0.299 * (pixels[offset] ?? 0) +
          0.587 * (pixels[offset + 1] ?? 0) +
          0.114 * (pixels[offset + 2] ?? 0),
      );
    }

    return { width, height, data };
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.mode() === 'focus') {
      this.setFocalFrom(event);
      return;
    }

    this.dragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.dragging || this.mode() === 'focus') return;

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;

    const box = this.stage()?.nativeElement.getBoundingClientRect();
    if (box === undefined) return;

    // Clamped per axis so the frame never shows past the image edge.
    const limits = this.panLimits();
    this.offsetX.update((current) =>
      Math.max(-limits.x, Math.min(limits.x, current + (dx / box.width) * 100)),
    );
    this.offsetY.update((current) =>
      Math.max(-limits.y, Math.min(limits.y, current + (dy / box.height) * 100)),
    );

    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }

  protected endDrag(): void {
    this.dragging = false;
  }

  /** Places the sharp point where the pointer landed, in stage coordinates. */
  private setFocalFrom(event: PointerEvent): void {
    const box = this.stage()?.nativeElement.getBoundingClientRect();
    if (box === undefined) return;

    this.focalX.set(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)));
    this.focalY.set(Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)));
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.zoom.update((current) =>
      Math.max(1, Math.min(4, current - Math.sign(event.deltaY) * 0.08)),
    );
    this.clampOffsets();
  }

  protected setZoom(event: Event): void {
    this.zoom.set(Number((event.target as HTMLInputElement).value));
    this.clampOffsets();
  }

  /** Zooming out shrinks the travel: pull the frame back inside it. */
  private clampOffsets(): void {
    const limits = this.panLimits();
    this.offsetX.update((current) => Math.max(-limits.x, Math.min(limits.x, current)));
    this.offsetY.update((current) => Math.max(-limits.y, Math.min(limits.y, current)));
  }

  protected setSharpRadius(event: Event): void {
    this.sharpRadius.set(Number((event.target as HTMLInputElement).value));
  }

  protected setBlurIntensity(event: Event): void {
    this.blurIntensity.set(Number((event.target as HTMLInputElement).value));
  }

  protected setSharpen(event: Event): void {
    this.sharpen.set(Number((event.target as HTMLInputElement).value));
  }

  protected setBrightness(event: Event): void {
    this.brightness.set(Number((event.target as HTMLInputElement).value));
  }

  protected setSaturation(event: Event): void {
    this.saturation.set(Number((event.target as HTMLInputElement).value));
  }

  protected reset(): void {
    this.autoFramed.set(false);
    this.zoom.set(1);
    this.offsetX.set(0);
    this.offsetY.set(0);
    this.focalX.set(0.5);
    this.focalY.set(0.5);
    this.sharpRadius.set(0.4);
    this.blurIntensity.set(0);
    this.sharpen.set(0);
    this.brightness.set(1);
    this.saturation.set(1);
  }

  private adjustments(): Adjustments {
    return {
      ...DEFAULT_ADJUSTMENTS,
      sharpen: this.sharpen(),
      brightness: this.brightness(),
      saturation: this.saturation(),
    };
  }

  /** Converts viewport state into normalised crop coordinates for the server. */
  protected emit(): void {
    if (this.file === null) return;

    const size = 1 / this.zoom();
    const centreX = 0.5 - this.offsetX() / 100;
    const centreY = 0.5 - this.offsetY() / 100;
    const clamp = (value: number): number => Math.max(0, Math.min(1 - size, value - size / 2));

    this.applied.emit({
      file: this.file,
      params: {
        crop: { x: clamp(centreX), y: clamp(centreY), size },
        depthOfField:
          this.blurIntensity() > 0
            ? {
                focal: { x: this.focalX(), y: this.focalY() },
                sharpRadius: this.sharpRadius(),
                blurIntensity: this.blurIntensity(),
              }
            : null,
        adjustments: this.adjustments(),
      },
    });
  }
}
