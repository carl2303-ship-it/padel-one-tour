import type { Tournament, TournamentCategory, Player, Team } from './supabase';

export const IG_WIDTH = 1080;
export const IG_HEIGHT = 1350;

export type RankingEntry = {
  position: number;
  title: string;
  subtitle?: string;
};

export type TeamLike = Team & {
  final_position?: number | null;
  player1?: Player | null;
  player2?: Player | null;
};

export type PackGender = 'male' | 'female' | 'mixed';

/** Category strength band used for distinct palettes (e.g. M2-M4 vs M4-M6). */
export type PackBand = '1-2' | '2-4' | '4-6';

export type PackTheme = {
  gender: PackGender;
  level: number | null;
  band: PackBand;
  label: string;
  top: string;
  mid: string;
  bottom: string;
  accent: string;
  accentSoft: string;
  genderLabel: string;
};

export type InstagramPackMeta = {
  tournamentName: string;
  categoryName?: string | null;
  dateLabel: string;
  theme: PackTheme;
  logoUrl?: string | null;
  status?: string;
};

export type GeneratedPackImage = {
  id: string;
  label: string;
  filename: string;
  dataUrl: string;
};

function isIndividualTournament(tournament: Tournament): boolean {
  return (
    tournament.format === 'individual_groups_knockout' ||
    tournament.format === 'mixed_american' ||
    (tournament.format === 'round_robin' && tournament.round_robin_type === 'individual')
  );
}

function getTeamPlayerNames(team?: TeamLike | null): string {
  if (!team) return '';
  const names: string[] = [];
  if (team.player1?.name) names.push(team.player1.name);
  if (team.player2?.name) names.push(team.player2.name);
  if (names.length > 0) return names.join(' / ');
  if (team.name?.includes(' / ')) return team.name;
  if (team.name?.includes(' e ')) return team.name.replace(' e ', ' / ');
  if (team.name?.includes(' & ')) return team.name.replace(' & ', ' / ');
  return team.name || '';
}

function positionLabel(pos: number): string {
  if (pos === 1) return '1º · Campeão';
  if (pos === 2) return '2º · Finalista';
  if (pos === 3) return '3º';
  return `${pos}º`;
}

export function formatTournamentDate(tournament: Tournament): string {
  const start = new Date(tournament.start_date);
  const end = new Date(tournament.end_date);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  if (Number.isNaN(start.getTime())) return '';
  if (Number.isNaN(end.getTime()) || tournament.start_date === tournament.end_date) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

export function getBrandPrimaryColor(): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--brand-primary').trim();
  return raw || '#D32F2F';
}

/** Detect gender from category name, accepted_levels, then tournament.gender */
export function detectPackGender(
  category?: TournamentCategory | null,
  tournament?: Tournament | null
): PackGender {
  const levels = (category?.accepted_levels || [])
    .map((l) => l.trim().toUpperCase())
    .filter(Boolean);
  const hasM = levels.some((l) => /^M[1-6]$/.test(l));
  const hasF = levels.some((l) => /^F[1-6]$/.test(l));
  if (hasM && hasF) return 'mixed';
  if (hasM) return 'male';
  if (hasF) return 'female';

  const name = (category?.name || '').toLowerCase();
  const maleHints = /\b(masc|masculin|homens|senhor|men|male|open m)\b|\bm[1-6]\b/;
  const femaleHints = /\b(fem|femin|mulher|senhoras|ladies|women|female|open f)\b|\bf[1-6]\b/;
  const mixedHints = /\b(misto|mixed|mixto|aberto|open)\b/;

  const maleHit = maleHints.test(name);
  const femaleHit = femaleHints.test(name);
  if (maleHit && femaleHit) return 'mixed';
  if (mixedHints.test(name) && !maleHit && !femaleHit) return 'mixed';
  if (maleHit) return 'male';
  if (femaleHit) return 'female';

  const tg = ((tournament as { gender?: string | null } | null | undefined)?.gender || '')
    .toLowerCase()
    .trim();
  if (tg === 'male' || tg === 'masculino' || tg === 'm') return 'male';
  if (tg === 'female' || tg === 'feminino' || tg === 'f') return 'female';
  if (tg === 'mixed' || tg === 'misto') return 'mixed';

  return 'mixed';
}

export function detectCategoryLevel(category?: TournamentCategory | null): number | null {
  const range = getCategorySkillRange(category);
  if (!range) return null;
  return Math.round((range.min + range.max) / 2);
}

/** Prefer min/max skill rating; fallback to name like "Niveis 2 - 4" or M2-M4. */
function getCategorySkillRange(
  category?: TournamentCategory | null
): { min: number; max: number } | null {
  if (!category) return null;

  const minL = category.min_level != null ? Number(category.min_level) : null;
  const maxL = category.max_level != null ? Number(category.max_level) : null;
  if (minL != null && maxL != null && !Number.isNaN(minL) && !Number.isNaN(maxL)) {
    return { min: Math.min(minL, maxL), max: Math.max(minL, maxL) };
  }

  const fromAccepted = (category.accepted_levels || [])
    .map((l) => l.trim().toUpperCase().match(/^[MF]([1-6])$/))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  if (fromAccepted.length > 0) {
    return { min: Math.min(...fromAccepted), max: Math.max(...fromAccepted) };
  }

  const name = (category.name || '').trim();
  // "Niveis 2 - 4", "1.5 - 3.5", "4.5-6"
  const decimalRange = name.match(/(\d+(?:[.,]\d+)?)\s*[-–—]\s*(\d+(?:[.,]\d+)?)/);
  if (decimalRange) {
    const a = parseFloat(decimalRange[1].replace(',', '.'));
    const b = parseFloat(decimalRange[2].replace(',', '.'));
    if (!Number.isNaN(a) && !Number.isNaN(b)) {
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
  }

  const mCodes = [...name.toUpperCase().matchAll(/\b[MF]([1-6])\b/g)].map((m) => Number(m[1]));
  if (mCodes.length > 0) {
    return { min: Math.min(...mCodes), max: Math.max(...mCodes) };
  }

  return null;
}

/** Map category to band 1-2 / 2-4 / 4-6 using skill mid-point. */
export function detectCategoryBand(category?: TournamentCategory | null): PackBand {
  const range = getCategorySkillRange(category);
  if (!range) return '2-4';
  const mid = (range.min + range.max) / 2;
  // APC: "Niveis 2-4" ~ mid 3; "Niveis 4-6" ~ mid 5; "1.5-3.5" ~ mid 2.5
  if (mid < 2.75) return '1-2';
  if (mid < 4.5) return '2-4';
  return '4-6';
}

type BandPalette = {
  top: string;
  mid: string;
  bottom: string;
  accent: string;
  accentSoft: string;
};

/** Distinct palettes — 2-4 vs 4-6 must be obviously different. */
const MALE_BANDS: Record<PackBand, BandPalette> = {
  // Strong / low numbers: black + burnt orange
  '1-2': {
    top: '#000000',
    mid: '#1A0A00',
    bottom: '#BF360C',
    accent: '#FF5722',
    accentSoft: '#FFAB91',
  },
  // Classic APC: black + orange
  '2-4': {
    top: '#000000',
    mid: '#1A1A1A',
    bottom: '#FF8800',
    accent: '#FF8800',
    accentSoft: '#FFB74D',
  },
  // Higher band: dark slate → light/silver (NOT orange fill) + orange accents only
  '4-6': {
    top: '#111111',
    mid: '#2A2A2A',
    bottom: '#E8E8E8',
    accent: '#FF8800',
    accentSoft: '#FFCC80',
  },
};

const FEMALE_BANDS: Record<PackBand, BandPalette> = {
  '1-2': {
    top: '#1A0610',
    mid: '#3B0A24',
    bottom: '#9D174D',
    accent: '#BE185D',
    accentSoft: '#F9A8D4',
  },
  '2-4': {
    top: '#1A0612',
    mid: '#4A0E2E',
    bottom: '#DB2777',
    accent: '#EC4899',
    accentSoft: '#F9A8D4',
  },
  '4-6': {
    top: '#2A1520',
    mid: '#4A3040',
    bottom: '#FCE7F3',
    accent: '#F472B6',
    accentSoft: '#FECDD3',
  },
};

const MIXED_BANDS: Record<PackBand, BandPalette> = {
  '1-2': MALE_BANDS['1-2'],
  '2-4': MALE_BANDS['2-4'],
  '4-6': {
    top: '#111111',
    mid: '#2A2A2A',
    bottom: '#FCE7F3',
    accent: '#EC4899',
    accentSoft: '#F9A8D4',
  },
};

export function resolvePackTheme(params: {
  category?: TournamentCategory | null;
  tournament?: Tournament | null;
  genderOverride?: PackGender | null;
  bandOverride?: PackBand | null;
}): PackTheme {
  const gender = params.genderOverride || detectPackGender(params.category, params.tournament);
  const level = detectCategoryLevel(params.category);
  const band = params.bandOverride || detectCategoryBand(params.category);

  const genderLabel =
    gender === 'male' ? 'Masculino' : gender === 'female' ? 'Feminino' : 'Misto';
  const palette =
    gender === 'male' ? MALE_BANDS[band] : gender === 'female' ? FEMALE_BANDS[band] : MIXED_BANDS[band];

  return {
    gender,
    level,
    band,
    label: `${genderLabel} · ${band}`,
    genderLabel,
    ...palette,
  };
}

export function buildRankingEntries(params: {
  tournament: Tournament;
  categoryId: string | null;
  teams: TeamLike[];
  players: Player[];
}): { entries: RankingEntry[]; withPositions: number; total: number; incomplete: boolean } {
  const { tournament, categoryId, teams, players } = params;
  const individual = isIndividualTournament(tournament);

  if (individual) {
    const filtered = players.filter((p) => {
      if (categoryId === 'no-category') return !p.category_id;
      if (categoryId) return p.category_id === categoryId;
      return true;
    });
    const withPos = filtered.filter((p) => p.final_position != null);
    const sorted = [...withPos].sort(
      (a, b) => (a.final_position || 999) - (b.final_position || 999)
    );
    const entries: RankingEntry[] = sorted.map((p) => ({
      position: p.final_position as number,
      title: p.name,
    }));
    return {
      entries,
      withPositions: withPos.length,
      total: filtered.length,
      incomplete: filtered.length > 0 && withPos.length < filtered.length,
    };
  }

  const filtered = teams.filter((t) => {
    if (categoryId === 'no-category') return !t.category_id;
    if (categoryId) return t.category_id === categoryId;
    return true;
  });
  const withPos = filtered.filter((t) => t.final_position != null);
  const sorted = [...withPos].sort(
    (a, b) => (a.final_position || 999) - (b.final_position || 999)
  );
  const entries: RankingEntry[] = sorted.map((t) => {
    const playersLabel = getTeamPlayerNames(t);
    return {
      position: t.final_position as number,
      title: playersLabel || t.name,
      subtitle: playersLabel && t.name && t.name !== playersLabel ? t.name : undefined,
    };
  });
  return {
    entries,
    withPositions: withPos.length,
    total: filtered.length,
    incomplete: filtered.length > 0 && withPos.length < filtered.length,
  };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

async function tryLoadImage(src?: string | null): Promise<HTMLImageElement | null> {
  if (!src) return null;
  try {
    return await loadImage(src);
  } catch {
    return null;
  }
}

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = IG_WIDTH;
  canvas.height = IG_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  return { canvas, ctx };
}

function drawBackground(ctx: CanvasRenderingContext2D, theme: PackTheme) {
  const g = ctx.createLinearGradient(0, 0, IG_WIDTH * 0.2, IG_HEIGHT);
  g.addColorStop(0, theme.top);
  g.addColorStop(0.45, theme.mid);
  g.addColorStop(1, theme.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, IG_WIDTH, IG_HEIGHT);

  ctx.save();
  if (theme.gender === 'male') {
    ctx.strokeStyle = 'rgba(255,136,0,0.14)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(-80 + i * 160, 0);
      ctx.lineTo(200 + i * 160, IG_HEIGHT);
      ctx.stroke();
    }
  } else if (theme.gender === 'female') {
    ctx.fillStyle = 'rgba(249,168,212,0.08)';
    for (let i = 0; i < 10; i++) {
      ctx.beginPath();
      ctx.arc(100 + i * 110, 160 + (i % 4) * 90, 50 + (i % 3) * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = 'rgba(255,136,0,0.10)';
    for (let i = 0; i < 6; i++) {
      roundRect(ctx, 40 + i * 180, 120 + (i % 2) * 70, 120, 120, 28);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  meta: InstagramPackMeta,
  logo: HTMLImageElement | null,
  eyebrow: string
) {
  const theme = meta.theme;

  if (logo) {
    const size = 96;
    ctx.drawImage(logo, 72, 64, size, size);
  }

  const badge = theme.label;
  ctx.font = '800 22px Inter, system-ui, sans-serif';
  const badgeW = Math.min(420, ctx.measureText(badge).width + 36);
  const badgeX = IG_WIDTH - 72 - badgeW;
  const badgeY = 72;
  roundRect(ctx, badgeX, badgeY, badgeW, 44, 22);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(badge, badgeX + badgeW / 2, badgeY + 30);
  ctx.textAlign = 'left';

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = '700 28px Inter, system-ui, sans-serif';
  ctx.fillText(eyebrow.toUpperCase(), logo ? 192 : 72, 110);

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 52px Inter, system-ui, sans-serif';
  wrapText(ctx, meta.tournamentName, logo ? 192 : 72, 170, IG_WIDTH - (logo ? 264 : 144), 56, 2);

  let y = 250;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '600 28px Inter, system-ui, sans-serif';
  if (meta.dateLabel) {
    ctx.fillText(meta.dateLabel, logo ? 192 : 72, y);
    y += 40;
  }
  if (meta.categoryName) {
    ctx.fillStyle = theme.accentSoft;
    ctx.font = '800 30px Inter, system-ui, sans-serif';
    ctx.fillText(meta.categoryName, logo ? 192 : 72, y);
  }
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  const visible = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = visible[visible.length - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 0) {
      last = last.slice(0, -1);
    }
    visible[visible.length - 1] = `${last}…`;
  }

  visible.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });
  return visible.length * lineHeight;
}

function drawFooter(ctx: CanvasRenderingContext2D, theme: PackTheme) {
  ctx.fillStyle = theme.accentSoft;
  ctx.globalAlpha = 0.85;
  ctx.font = '700 24px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PADEL ONE Tour', IG_WIDTH / 2, IG_HEIGHT - 48);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not export image'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Could not read image'));
        reader.readAsDataURL(blob);
      },
      'image/png'
    );
  });
}

function hexWithAlpha(hex: string, alphaHex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return `rgba(255,255,255,0.14)`;
  return `#${clean}${alphaHex}`;
}

export async function renderPodiumCard(
  meta: InstagramPackMeta,
  entries: RankingEntry[]
): Promise<string> {
  const { canvas, ctx } = createCanvas();
  const logo = await tryLoadImage(meta.logoUrl);
  drawBackground(ctx, meta.theme);
  drawHeader(ctx, meta, logo, 'Pódio');

  const podium = entries.filter((e) => e.position >= 1 && e.position <= 3).slice(0, 3);
  const order = [2, 1, 3];
  const slots = order
    .map((pos) => podium.find((e) => e.position === pos))
    .filter(Boolean) as RankingEntry[];

  const baseY = 980;
  const centers = [220, 540, 860];
  const heights = [220, 300, 180];
  const medals = ['#C0C0C0', '#FFD700', '#CD7F32'];

  if (slots.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 36px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sem posições finais ainda', IG_WIDTH / 2, 700);
    ctx.font = '600 28px Inter, system-ui, sans-serif';
    ctx.fillText('Finaliza o torneio para gerar o pódio', IG_WIDTH / 2, 760);
    ctx.textAlign = 'left';
  } else if (podium.length < 2) {
    const entry = podium[0];
    roundRect(ctx, 100, 420, IG_WIDTH - 200, 420, 28);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.strokeStyle = meta.theme.accent;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = medals[entry.position === 1 ? 1 : entry.position === 2 ? 0 : 2];
    ctx.font = '900 72px Inter, system-ui, sans-serif';
    ctx.fillText(positionLabel(entry.position), IG_WIDTH / 2, 540);
    ctx.fillStyle = '#fff';
    ctx.font = '800 44px Inter, system-ui, sans-serif';
    const nameLines = entry.title.split(' / ');
    nameLines.slice(0, 3).forEach((line, li) => {
      ctx.fillText(line, IG_WIDTH / 2, 620 + li * 52);
    });
    if (entry.subtitle) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '600 28px Inter, system-ui, sans-serif';
      ctx.fillText(entry.subtitle, IG_WIDTH / 2, 780);
    }
    ctx.textAlign = 'left';
  } else {
    order.forEach((pos, idx) => {
      const entry = podium.find((e) => e.position === pos);
      if (!entry) return;
      const cx = centers[idx];
      const h = heights[idx];
      const barY = baseY - h;

      roundRect(ctx, cx - 130, barY, 260, h, 20);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      ctx.strokeStyle = idx === 1 ? meta.theme.accent : medals[idx];
      ctx.lineWidth = idx === 1 ? 5 : 4;
      ctx.stroke();

      ctx.fillStyle = medals[idx];
      ctx.font = '900 48px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${pos}º`, cx, barY + 70);

      ctx.fillStyle = '#fff';
      ctx.font = '800 28px Inter, system-ui, sans-serif';
      const lines = entry.title.split(' / ');
      lines.slice(0, 3).forEach((line, li) => {
        const clipped =
          ctx.measureText(line).width > 220
            ? `${line.slice(0, Math.max(8, Math.floor((220 / ctx.measureText(line).width) * line.length)))}…`
            : line;
        ctx.fillText(clipped, cx, barY + 130 + li * 36);
      });
    });
    ctx.textAlign = 'left';
  }

  drawFooter(ctx, meta.theme);
  return canvasToDataUrl(canvas);
}

export async function renderStandingsCard(
  meta: InstagramPackMeta,
  entries: RankingEntry[],
  limit = 8
): Promise<string> {
  const { canvas, ctx } = createCanvas();
  const logo = await tryLoadImage(meta.logoUrl);
  drawBackground(ctx, meta.theme);
  drawHeader(ctx, meta, logo, 'Classificação');

  const list = entries.slice(0, limit);
  const startY = 320;
  const rowH = 96;

  if (list.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '700 36px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Sem classificação final', IG_WIDTH / 2, 700);
    ctx.textAlign = 'left';
  } else {
    list.forEach((entry, i) => {
      const y = startY + i * rowH;
      roundRect(ctx, 72, y, IG_WIDTH - 144, rowH - 12, 18);
      ctx.fillStyle = i < 3 ? hexWithAlpha(meta.theme.accent, '33') : 'rgba(0,0,0,0.28)';
      ctx.fill();
      if (i < 3) {
        ctx.strokeStyle = meta.theme.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#fff';
      ctx.font = '900 36px Inter, system-ui, sans-serif';
      ctx.fillText(`${entry.position}º`, 100, y + 58);

      ctx.fillStyle = '#fff';
      ctx.font = '800 32px Inter, system-ui, sans-serif';
      const nameX = 200;
      const maxW = IG_WIDTH - nameX - 100;
      let title = entry.title;
      if (ctx.measureText(title).width > maxW) {
        while (title.length > 0 && ctx.measureText(`${title}…`).width > maxW) {
          title = title.slice(0, -1);
        }
        title = `${title}…`;
      }
      ctx.fillText(title, nameX, y + 48);

      if (entry.subtitle) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '600 22px Inter, system-ui, sans-serif';
        ctx.fillText(entry.subtitle, nameX, y + 76);
      }
    });
  }

  drawFooter(ctx, meta.theme);
  return canvasToDataUrl(canvas);
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number
) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = x + (w - dw) / 2;
  const dy = y + (h - dh) / 2;
  ctx.save();
  roundRect(ctx, x, y, w, h, 24);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

export async function renderPhotoCard(
  meta: InstagramPackMeta,
  photoSrc: string,
  title: string
): Promise<string> {
  const { canvas, ctx } = createCanvas();
  const [logo, photo] = await Promise.all([
    tryLoadImage(meta.logoUrl),
    loadImage(photoSrc),
  ]);
  drawBackground(ctx, meta.theme);
  drawHeader(ctx, meta, logo, title);

  const frameX = 72;
  const frameY = 300;
  const frameW = IG_WIDTH - 144;
  const frameH = 880;

  roundRect(ctx, frameX - 8, frameY - 8, frameW + 16, frameH + 16, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();
  ctx.strokeStyle = meta.theme.accent;
  ctx.lineWidth = 4;
  ctx.stroke();

  drawCoverImage(ctx, photo, frameX, frameY, frameW, frameH);

  drawFooter(ctx, meta.theme);
  return canvasToDataUrl(canvas);
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

export async function generateInstagramPack(params: {
  tournament: Tournament;
  category?: TournamentCategory | null;
  categoryId: string | null;
  teams: TeamLike[];
  players: Player[];
  logoUrl?: string | null;
  groupPhotoSrc?: string | null;
  winnersPhotoSrc?: string | null;
  genderOverride?: PackGender | null;
  bandOverride?: PackBand | null;
}): Promise<{
  images: GeneratedPackImage[];
  incomplete: boolean;
  withPositions: number;
  total: number;
  theme: PackTheme;
}> {
  const ranking = buildRankingEntries({
    tournament: params.tournament,
    categoryId: params.categoryId,
    teams: params.teams,
    players: params.players,
  });

  const categoryName =
    params.categoryId === 'no-category'
      ? 'Sem categoria'
      : params.category?.name || null;

  const theme = resolvePackTheme({
    category: params.category,
    tournament: params.tournament,
    genderOverride: params.genderOverride,
    bandOverride: params.bandOverride,
  });

  const meta: InstagramPackMeta = {
    tournamentName: params.tournament.name,
    categoryName,
    dateLabel: formatTournamentDate(params.tournament),
    theme,
    logoUrl: params.logoUrl,
    status: params.tournament.status,
  };

  const base = slugify(params.tournament.name) || 'torneio';
  const catSlug = categoryName ? `-${slugify(categoryName)}` : '';
  const genderSlug = `-${theme.gender}`;
  const images: GeneratedPackImage[] = [];

  const podiumUrl = await renderPodiumCard(meta, ranking.entries);
  images.push({
    id: 'podium',
    label: 'Pódio',
    filename: `${base}${catSlug}${genderSlug}-podio.png`,
    dataUrl: podiumUrl,
  });

  const standingsUrl = await renderStandingsCard(meta, ranking.entries, 8);
  images.push({
    id: 'standings',
    label: 'Classificação',
    filename: `${base}${catSlug}${genderSlug}-classificacao.png`,
    dataUrl: standingsUrl,
  });

  if (params.groupPhotoSrc) {
    const url = await renderPhotoCard(meta, params.groupPhotoSrc, 'Foto de grupo');
    images.push({
      id: 'group',
      label: 'Foto de grupo',
      filename: `${base}${catSlug}${genderSlug}-foto-grupo.png`,
      dataUrl: url,
    });
  }

  if (params.winnersPhotoSrc) {
    const url = await renderPhotoCard(meta, params.winnersPhotoSrc, 'Vencedores');
    images.push({
      id: 'winners',
      label: 'Vencedores',
      filename: `${base}${catSlug}${genderSlug}-foto-vencedores.png`,
      dataUrl: url,
    });
  }

  return {
    images,
    incomplete: ranking.incomplete || ranking.withPositions === 0,
    withPositions: ranking.withPositions,
    total: ranking.total,
    theme,
  };
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function downloadAllImages(images: GeneratedPackImage[], delayMs = 350) {
  for (const image of images) {
    downloadDataUrl(image.dataUrl, image.filename);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}
