/**
 * Mapping between numeric padel level and M1–M6 / F1–F6 categories.
 * Convention used in registration defaults and existing player_accounts data:
 *   M1/F1=7, M2/F2=6, M3/F3=5, M4/F4=4, M5/F5=3, M6/F6=2
 */

export type PlayerGenderHint = 'M' | 'F' | 'male' | 'female' | string | null | undefined;

export function levelFromCategory(cat: string | null | undefined): number | null {
  if (!cat) return null;
  const m = cat.toUpperCase().trim().match(/^[MF](\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const map: Record<number, number> = { 1: 7.0, 2: 6.0, 3: 5.0, 4: 4.0, 5: 3.0, 6: 2.0 };
  return map[n] ?? null;
}

export function genderPrefixFromHint(
  hint: PlayerGenderHint,
  existingCategory?: string | null,
): 'M' | 'F' | null {
  if (existingCategory) {
    const letter = existingCategory.trim().toUpperCase().charAt(0);
    if (letter === 'M' || letter === 'F') return letter;
  }
  if (!hint) return null;
  const g = String(hint).trim().toLowerCase();
  if (g === 'm' || g === 'male' || g === 'masculino') return 'M';
  if (g === 'f' || g === 'female' || g === 'feminino') return 'F';
  return null;
}

/** Map numeric level → category digit 1–6 (nearest band). */
export function categoryDigitFromLevel(level: number): number {
  const rounded = Math.round(level);
  return Math.min(6, Math.max(1, 8 - rounded));
}

/**
 * Derive M#/F# from numeric level.
 * Returns null if gender cannot be inferred (avoids inventing M/F).
 */
export function categoryFromLevel(
  level: number | null | undefined,
  genderHint?: PlayerGenderHint,
  existingCategory?: string | null,
): string | null {
  if (level == null || !Number.isFinite(level)) return null;
  const prefix = genderPrefixFromHint(genderHint, existingCategory);
  if (!prefix) return null;
  return `${prefix}${categoryDigitFromLevel(level)}`;
}
