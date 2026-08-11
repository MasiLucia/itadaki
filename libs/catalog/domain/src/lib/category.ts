/** Minutes from local midnight. `endMinute` is exclusive. */
export interface TimeWindow {
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface Category {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly availability: TimeWindow | null;
}

/** Windows that wrap past midnight (e.g. 22:00–02:00) are treated as contiguous. */
export function isWithinWindow(window: TimeWindow, minuteOfDay: number): boolean {
  if (window.startMinute <= window.endMinute) {
    return minuteOfDay >= window.startMinute && minuteOfDay < window.endMinute;
  }
  return minuteOfDay >= window.startMinute || minuteOfDay < window.endMinute;
}

export function isCategoryAvailableAt(category: Category, minuteOfDay: number): boolean {
  return category.availability === null || isWithinWindow(category.availability, minuteOfDay);
}
