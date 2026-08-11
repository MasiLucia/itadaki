import { type Money, type Result, err, ok } from '@itadaki/shared/domain';

export interface Modifier {
  readonly id: string;
  readonly name: string;
  readonly priceDelta: Money;
  readonly available: boolean;
}

export interface ModifierGroup {
  readonly id: string;
  readonly productId: string;
  readonly name: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly modifiers: readonly Modifier[];
}

export type ModifierSelectionError =
  | { readonly kind: 'TOO_FEW_SELECTIONS'; readonly groupId: string; readonly min: number; readonly received: number }
  | { readonly kind: 'TOO_MANY_SELECTIONS'; readonly groupId: string; readonly max: number; readonly received: number }
  | { readonly kind: 'UNKNOWN_MODIFIER'; readonly groupId: string; readonly modifierId: string }
  | { readonly kind: 'MODIFIER_UNAVAILABLE'; readonly groupId: string; readonly modifierId: string };

export function validateSelection(
  group: ModifierGroup,
  selectedIds: readonly string[],
): Result<readonly Modifier[], ModifierSelectionError> {
  const unique = [...new Set(selectedIds)];

  if (unique.length < group.minSelections) {
    return err({
      kind: 'TOO_FEW_SELECTIONS',
      groupId: group.id,
      min: group.minSelections,
      received: unique.length,
    });
  }
  if (unique.length > group.maxSelections) {
    return err({
      kind: 'TOO_MANY_SELECTIONS',
      groupId: group.id,
      max: group.maxSelections,
      received: unique.length,
    });
  }

  const selected: Modifier[] = [];
  for (const id of unique) {
    const modifier = group.modifiers.find((candidate) => candidate.id === id);
    if (modifier === undefined) {
      return err({ kind: 'UNKNOWN_MODIFIER', groupId: group.id, modifierId: id });
    }
    if (!modifier.available) {
      return err({ kind: 'MODIFIER_UNAVAILABLE', groupId: group.id, modifierId: id });
    }
    selected.push(modifier);
  }
  return ok(selected);
}
