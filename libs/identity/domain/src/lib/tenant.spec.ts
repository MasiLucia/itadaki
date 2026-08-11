import { prepareTenant, slugify, uniqueSlug } from './tenant';

describe('slugify', () => {
  it('folds accents instead of dropping the letter', () => {
    expect(slugify('Parrilla Don José')).toBe('parrilla-don-jose');
  });

  it('handles the ñ, which is not a diacritic in NFC', () => {
    // Decomposed by NFD into n + tilde, so the tilde is what gets stripped.
    expect(slugify('El Niño')).toBe('el-nino');
  });

  it('collapses punctuation and spacing into single hyphens', () => {
    expect(slugify('Bodegón  "La Esquina" — Centro')).toBe('bodegon-la-esquina-centro');
  });

  it('never starts or ends with a hyphen', () => {
    expect(slugify('  ¡Che, Boludo!  ')).toBe('che-boludo');
  });

  it('caps length so the slug stays usable in a link', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(40);
  });
});

describe('prepareTenant', () => {
  it('accepts a normal restaurant name', () => {
    const result = prepareTenant('  Parrilla   Don José ');
    if (result.isErr()) throw new Error('expected ok');
    // Inner whitespace is collapsed, so the stored name is tidy too.
    expect(result.value.name).toBe('Parrilla Don José');
    expect(result.value.slug).toBe('parrilla-don-jose');
  });

  it('rejects a name that is too short to identify anything', () => {
    const result = prepareTenant('a');
    if (result.isOk()) throw new Error('expected err');
    expect(result.error.kind).toBe('NAME_TOO_SHORT');
  });

  it('rejects an overly long name', () => {
    const result = prepareTenant('x'.repeat(61));
    if (result.isOk()) throw new Error('expected err');
    expect(result.error.kind).toBe('NAME_TOO_LONG');
  });

  it('rejects a name that slugifies to nothing', () => {
    // Would otherwise create a tenant with an empty, unreachable identifier.
    const result = prepareTenant('!!! ???');
    if (result.isOk()) throw new Error('expected err');
    expect(result.error.kind).toBe('NAME_NOT_USABLE');
  });
});

describe('uniqueSlug', () => {
  it('keeps the base slug when nothing claims it', () => {
    expect(uniqueSlug('la-esquina', new Set())).toBe('la-esquina');
  });

  it('suffixes when two restaurants share a name', () => {
    expect(uniqueSlug('la-esquina', new Set(['la-esquina']))).toBe('la-esquina-2');
  });

  it('keeps counting past the first collision', () => {
    const taken = new Set(['la-esquina', 'la-esquina-2', 'la-esquina-3']);
    expect(uniqueSlug('la-esquina', taken)).toBe('la-esquina-4');
  });
});
