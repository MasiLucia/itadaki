import { Injectable, signal } from '@angular/core';

const VISIBLE_MS = 2400;

/**
 * Brief confirmations, shown after the screen they belong to has changed.
 *
 * A signal rather than per-page state: adding a dish confirms on the carte,
 * not on the product page it was tapped from.
 */
@Injectable({ providedIn: 'root' })
export class ToastStore {
  readonly message = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string): void {
    if (this.timer !== null) clearTimeout(this.timer);

    this.message.set(message);
    this.timer = setTimeout(() => {
      this.message.set(null);
      this.timer = null;
    }, VISIBLE_MS);
  }
}
