import { Pipe, type PipeTransform } from '@angular/core';
import { type Money, minorUnitExponent } from '@itadaki/shared/domain';

/**
 * Formats Money for display. Reads the minor-unit exponent from the currency
 * rather than assuming cents, so a zero-decimal currency stays correct.
 */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(value: Money | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }
    const exponent = minorUnitExponent(value.currency);
    const major = value.amountInMinorUnits / 10 ** exponent;

    return new Intl.NumberFormat('es-AR', {
      style: 'currency',
      currency: value.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(major);
  }
}
