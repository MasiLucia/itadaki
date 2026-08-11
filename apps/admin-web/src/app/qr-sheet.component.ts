import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { encodeQr, isQrError, qrToSvgPath } from '@itadaki/shared/domain';

export interface QrTable {
  readonly id: string;
  readonly label: string;
  readonly seats: number;
  readonly url: string;
}

interface RenderedQr {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly size: number;
  readonly failed: boolean;
}

/**
 * Print sheet of table QR codes.
 *
 * One card per table, sized for A4 and cut lines included, because the point
 * of this screen is a stack of cards a restaurant can laminate and put on the
 * tables — not a link to copy somewhere else.
 */
@Component({
  selector: 'itd-qr-sheet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './qr-sheet.component.css',
  template: `
    <div class="bar no-print">
      <div class="bar-text">
        <strong>{{ rendered().length }} mesa{{ rendered().length === 1 ? '' : 's' }}</strong>
        <span class="hint">
          Imprimí, recortá y pegá una en cada mesa. Los códigos vencen a las 8 horas
          y se renuevan al volver a abrir esta pantalla.
        </span>
      </div>
      <div class="bar-actions">
        <button type="button" class="ghost" (click)="close.emit()">Volver</button>
        <button type="button" class="print" (click)="print()">Imprimir</button>
      </div>
    </div>

    <div class="sheet">
      @for (qr of rendered(); track qr.id) {
        <article class="card">
          @if (qr.failed) {
            <p class="failed">No pudimos generar el código de {{ qr.label }}.</p>
          } @else {
            <p class="brand">ITADAKI</p>
            <p class="table-name">{{ qr.label }}</p>

            <svg
              class="qr"
              [attr.viewBox]="'0 0 ' + qr.size + ' ' + qr.size"
              shape-rendering="crispEdges"
              [attr.aria-label]="'Código QR de ' + qr.label"
              role="img"
            >
              <rect [attr.width]="qr.size" [attr.height]="qr.size" fill="white" />
              <path [attr.d]="qr.path" fill="black" />
            </svg>

            <p class="instruction">escaneá y pedí desde tu celu</p>
          }
        </article>
      } @empty {
        <p class="empty no-print">Todavía no cargaste ninguna mesa.</p>
      }
    </div>
  `,
})
export class QrSheetComponent {
  readonly tables = input.required<readonly QrTable[]>();
  readonly close = output<void>();

  /**
   * Encoding is pure and runs once per table list, so it stays in a computed
   * rather than being redone on every change detection pass.
   */
  protected readonly rendered = computed<readonly RenderedQr[]>(() =>
    this.tables().map((table) => {
      const matrix = encodeQr(table.url);
      if (isQrError(matrix)) {
        return { id: table.id, label: table.label, path: '', size: 0, failed: true };
      }
      return {
        id: table.id,
        label: table.label,
        path: qrToSvgPath(matrix),
        size: matrix.size,
        failed: false,
      };
    }),
  );

  protected print(): void {
    globalThis.print();
  }
}
