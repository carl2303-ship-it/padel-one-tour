/**
 * Alinhado com a lógica em padel-one-player App.tsx (categorias / accepted_levels / nome).
 */

export type TournamentCategoryEligibility = {
  name: string;
  accepted_levels: string[] | null;
  min_level: number | null;
  max_level: number | null;
};

export type PlayerEligibilityFields = {
  player_category: string | null;
  level: number | null;
};

function parsePlayerCategory(
  playerCategory: string | null,
): { gender: "M" | "F"; level: number } | null {
  if (!playerCategory) return null;
  const cat = playerCategory.toUpperCase().trim();
  const match = cat.match(/^([MF])(\d+)$/);
  if (match) {
    return { gender: match[1] as "M" | "F", level: parseInt(match[2], 10) };
  }
  return null;
}

/** Compatibilidade pelo nome da categoria (quando não há accepted_levels nem min/max na BD). */
export function isCategoryCompatibleByName(
  categoryName: string,
  playerGender: "M" | "F",
  playerLevel: number,
): boolean {
  const catUpper = categoryName.toUpperCase().trim();
  const levelMatches = catUpper.match(/\d+/g);
  const levels = levelMatches
    ? levelMatches.map(Number).filter((n) => n >= 1 && n <= 7)
    : [];

  const isMixed = catUpper.startsWith("MX") || catUpper.includes("MIST") || catUpper.includes("MIX");
  const hasMaleRef =
    !isMixed &&
    (catUpper.match(/^M\d/) != null ||
      catUpper.match(/\/M\d/) != null ||
      catUpper.includes("MASC") ||
      catUpper.includes("MASCULINO"));
  const hasFemaleRef =
    catUpper.startsWith("F") || catUpper.includes("FEM") || catUpper.includes("FEMININO");

  if (!hasMaleRef && !hasFemaleRef && !isMixed && levels.length === 0) return true;

  if (hasMaleRef && playerGender !== "M") return false;
  if (hasFemaleRef && playerGender !== "F") return false;

  if (levels.length > 0) {
    return levels.includes(playerLevel);
  }

  return true;
}

/** Indica se o jogador pode inscrever-se nesta categoria de torneio (regra igual à app Player). */
export function isPlayerEligibleForCategory(
  cat: TournamentCategoryEligibility,
  player: PlayerEligibilityFields,
): boolean {
  const hasAcceptedLevels = cat.accepted_levels != null && cat.accepted_levels.length > 0;
  const hasLevelRange = cat.min_level != null || cat.max_level != null;

  if (hasAcceptedLevels || hasLevelRange) {
    if (hasAcceptedLevels) {
      const accepted = cat.accepted_levels!.map((a) => String(a).toUpperCase().trim());
      const playerCat = String(player.player_category || "").toUpperCase().trim();
      if (!playerCat || !accepted.includes(playerCat)) {
        return false;
      }
    }
    if (hasLevelRange && player.level == null) {
      return false;
    }
    if (hasLevelRange) {
      if (cat.min_level != null && player.level! < cat.min_level) return false;
      if (cat.max_level != null && player.level! > cat.max_level) return false;
    }
    return true;
  }

  const info = parsePlayerCategory(player.player_category);
  if (!info) return true;
  return isCategoryCompatibleByName(cat.name, info.gender, info.level);
}
