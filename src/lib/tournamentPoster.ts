import type { Tournament, TournamentCategory } from './supabase';
import {
  formatTournamentDate,
  resolvePackTheme,
  type PackTheme,
} from './instagramPack';

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1350;

/** Distinct Padel1 category colors (M1–M6 / F1–F6). */
export const PADEL1_LEVEL_COLORS: Record<string, string> = {
  M1: '#B71C1C',
  M2: '#E65100',
  M3: '#F9A825',
  M4: '#2E7D32',
  M5: '#1565C0',
  M6: '#6A1B9A',
  F1: '#880E4F',
  F2: '#C2185B',
  F3: '#EC407A',
  F4: '#AB47BC',
  F5: '#7E57C2',
  F6: '#5C6BC0',
};

export type PosterCategoryInput = {
  name: string;
  accepted_levels?: string[] | null;
  min_level?: number | null;
  max_level?: number | null;
};

export type TournamentPosterInput = {
  tournamentName: string;
  clubName?: string | null;
  logoUrl?: string | null;
  startDate: string;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  categories: PosterCategoryInput[];
  gender?: string | null;
  memberPrice?: number | null;
  nonMemberPrice?: number | null;
  /** Free-text: what the fee includes (balls, dinner, t-shirt…) */
  includes?: string | null;
  /** Public registration URL (QR + caption). Images themselves are not clickable on WhatsApp. */
  registrationUrl?: string | null;
};

function createCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  return { canvas, ctx };
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  align: CanvasTextAlign = 'left'
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

  const prev = ctx.textAlign;
  ctx.textAlign = align;
  const drawX = align === 'center' ? x + maxWidth / 2 : x;
  visible.forEach((line, i) => {
    ctx.fillText(line, drawX, y + i * lineHeight);
  });
  ctx.textAlign = prev;
  return visible.length * lineHeight;
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

function formatTimeLabel(start?: string | null, end?: string | null): string {
  const clean = (t?: string | null) => (t ? t.slice(0, 5) : '');
  const s = clean(start);
  const e = clean(end);
  if (s && e) return `${s} – ${e}`;
  return s || e || '';
}

function formatDateLabel(startDate: string, endDate?: string | null): string {
  const fake = {
    start_date: startDate,
    end_date: endDate || startDate,
  } as Tournament;
  return formatTournamentDate(fake);
}

function formatEuro(n?: number | null): string | null {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Number(n);
  if (v <= 0) return null;
  return `${v.toFixed(v % 1 === 0 ? 0 : 2)}€`;
}

export function levelsForCategory(cat: PosterCategoryInput): string[] {
  const accepted = (cat.accepted_levels || [])
    .map((l) => l.trim().toUpperCase())
    .filter((l) => /^[MF][1-6]$/.test(l));
  if (accepted.length > 0) {
    return [...new Set(accepted)].sort((a, b) => a.localeCompare(b));
  }

  const minL = cat.min_level != null ? Number(cat.min_level) : null;
  const maxL = cat.max_level != null ? Number(cat.max_level) : null;
  if (minL != null && maxL != null && !Number.isNaN(minL) && !Number.isNaN(maxL)) {
    const lo = Math.max(1, Math.round(Math.min(minL, maxL)));
    const hi = Math.min(6, Math.round(Math.max(minL, maxL)));
    const genderHint = /\bf\b|fem/i.test(cat.name) ? 'F' : 'M';
    const out: string[] = [];
    for (let i = lo; i <= hi; i++) out.push(`${genderHint}${i}`);
    return out;
  }

  const fromName = [...cat.name.toUpperCase().matchAll(/\b([MF][1-6])\b/g)].map((m) => m[1]);
  return [...new Set(fromName)];
}

function colorForLevel(code: string): string {
  return PADEL1_LEVEL_COLORS[code.toUpperCase()] || '#546E7A';
}

function drawBackground(ctx: CanvasRenderingContext2D, theme: PackTheme) {
  const g = ctx.createLinearGradient(0, 0, POSTER_WIDTH * 0.15, POSTER_HEIGHT);
  g.addColorStop(0, theme.top);
  g.addColorStop(0.5, theme.mid);
  g.addColorStop(1, theme.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 10; i++) {
    ctx.beginPath();
    ctx.moveTo(-40 + i * 140, 0);
    ctx.lineTo(220 + i * 140, POSTER_HEIGHT);
    ctx.stroke();
  }
  ctx.restore();
}

async function loadQrImage(url: string): Promise<HTMLImageElement | null> {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data=${encodeURIComponent(url)}`;
  return tryLoadImage(qrSrc);
}

/**
 * Generate announcement poster (1080×1350) for Padel1 app + WhatsApp groups.
 * Note: WhatsApp images are not clickable — use QR + share the link in the caption.
 */
export async function generateTournamentPoster(input: TournamentPosterInput): Promise<string> {
  const { canvas, ctx } = createCanvas();

  const primaryCat = input.categories[0]
    ? ({
        name: input.categories[0].name,
        accepted_levels: input.categories[0].accepted_levels,
        min_level: input.categories[0].min_level,
        max_level: input.categories[0].max_level,
      } as TournamentCategory)
    : null;

  const theme = resolvePackTheme({
    category: primaryCat,
    tournament: { gender: input.gender } as Tournament,
  });

  drawBackground(ctx, theme);

  const logo = await tryLoadImage(input.logoUrl);
  const qr = input.registrationUrl ? await loadQrImage(input.registrationUrl) : null;
  const pad = 56;
  let y = 40;

  // —— Large centered club logo ——
  const logoSize = 220;
  if (logo) {
    const scale = Math.min(logoSize / logo.width, logoSize / logo.height);
    const dw = logo.width * scale;
    const dh = logo.height * scale;
    const dx = (POSTER_WIDTH - dw) / 2;
    ctx.drawImage(logo, dx, y + (logoSize - dh) / 2, dw, dh);
  } else {
    roundRect(ctx, (POSTER_WIDTH - logoSize) / 2, y, logoSize, logoSize, 28);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
  }
  y += logoSize + 18;

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CLUBE', POSTER_WIDTH / 2, y);
  y += 36;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 42px Inter, system-ui, sans-serif';
  const clubH = wrapText(
    ctx,
    input.clubName?.trim() || 'Padel One',
    pad,
    y,
    POSTER_WIDTH - pad * 2,
    46,
    2,
    'center'
  );
  ctx.textAlign = 'left';
  y += clubH + 20;

  // Accent
  roundRect(ctx, (POSTER_WIDTH - 100) / 2, y, 100, 7, 4);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  y += 36;

  ctx.fillStyle = theme.accentSoft;
  ctx.font = '800 24px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TORNEIO', POSTER_WIDTH / 2, y);
  y += 44;

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 52px Inter, system-ui, sans-serif';
  const titleH = wrapText(
    ctx,
    input.tournamentName.trim() || 'Torneio',
    pad,
    y,
    POSTER_WIDTH - pad * 2,
    56,
    2,
    'center'
  );
  ctx.textAlign = 'left';
  y += titleH + 22;

  // Date / time
  const dateLabel = formatDateLabel(input.startDate, input.endDate);
  const timeLabel = formatTimeLabel(input.startTime, input.endTime);
  const dateCardH = 96;
  roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, dateCardH, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '700 18px Inter, system-ui, sans-serif';
  ctx.fillText('DATA', pad + 28, y + 32);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 34px Inter, system-ui, sans-serif';
  ctx.fillText(dateLabel || '—', pad + 28, y + 70);
  if (timeLabel) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.fillText('HORA', pad + 520, y + 32);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 34px Inter, system-ui, sans-serif';
    ctx.fillText(timeLabel, pad + 520, y + 70);
  }
  y += dateCardH + 18;

  // Price + includes
  const member = formatEuro(input.memberPrice);
  const nonMember = formatEuro(input.nonMemberPrice);
  const includes = (input.includes || '').trim();
  if (member || nonMember || includes) {
    const priceH = includes ? 150 : 100;
    roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, priceH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.fillText('PREÇO', pad + 28, y + 32);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 32px Inter, system-ui, sans-serif';
    let priceLine = '';
    if (member && nonMember && member !== nonMember) {
      priceLine = `Membros ${member}  ·  Não-membros ${nonMember}`;
    } else {
      priceLine = member || nonMember || '';
    }
    if (priceLine) ctx.fillText(priceLine, pad + 28, y + 72);

    if (includes) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '700 18px Inter, system-ui, sans-serif';
      ctx.fillText('INCLUI', pad + 28, y + 104);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 26px Inter, system-ui, sans-serif';
      wrapText(ctx, includes, pad + 28, y + 134, POSTER_WIDTH - pad * 2 - 56, 28, 1);
    }
    y += priceH + 16;
  }

  // Categories (compact)
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '800 20px Inter, system-ui, sans-serif';
  ctx.fillText('CATEGORIAS · NÍVEIS PADEL1', pad, y + 8);
  y += 18;

  const cats = input.categories.length > 0 ? input.categories : [{ name: 'Open' }];
  const footerReserve = input.registrationUrl ? 210 : 70;
  const maxY = POSTER_HEIGHT - footerReserve;
  const rowH = 68;
  const visibleCats = cats.slice(0, Math.max(1, Math.floor((maxY - y) / rowH)));

  for (const cat of visibleCats) {
    y += 12;
    roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, 56, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px Inter, system-ui, sans-serif';
    ctx.fillText(cat.name, pad + 22, y + 36);

    const levels = levelsForCategory(cat);
    let chipX = POSTER_WIDTH - pad - 22;
    ctx.font = '800 18px Inter, system-ui, sans-serif';
    for (let i = levels.length - 1; i >= 0; i--) {
      const code = levels[i];
      const tw = ctx.measureText(code).width + 22;
      chipX -= tw;
      roundRect(ctx, chipX, y + 12, tw, 32, 10);
      ctx.fillStyle = colorForLevel(code);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(code, chipX + 11, y + 34);
      chipX -= 8;
    }
    y += 56;
  }

  // Registration CTA: QR + pill (WA images aren't clickable — QR opens the link)
  if (input.registrationUrl) {
    const blockY = POSTER_HEIGHT - 200;
    const qrSize = 132;
    roundRect(ctx, pad, blockY, POSTER_WIDTH - pad * 2, 148, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (qr) {
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, pad + 18, blockY + 8, qrSize, qrSize, 12);
      ctx.fill();
      ctx.drawImage(qr, pad + 22, blockY + 12, qrSize - 8, qrSize - 8);
    }

    const pillX = pad + (qr ? qrSize + 36 : 28);
    const pillW = POSTER_WIDTH - pad - pillX - 28;
    const pillY = blockY + 28;
    const pillH = 56;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INSCRIÇÃO ONLINE', pillX + pillW / 2, pillY + 36);
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 18px Inter, system-ui, sans-serif';
    const shortUrl = input.registrationUrl.replace(/^https?:\/\//, '');
    wrapText(ctx, shortUrl, pillX, pillY + 88, pillW, 22, 2);
  }

  ctx.fillStyle = theme.accentSoft;
  ctx.globalAlpha = 0.9;
  ctx.font = '700 20px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PADEL ONE  ·  Padel1', POSTER_WIDTH / 2, POSTER_HEIGHT - 28);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';

  return canvasToDataUrl(canvas);
}

export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function buildRegistrationUrl(tournamentId: string, origin = window.location.origin): string {
  return `${origin}?register=${tournamentId}`;
}

export function buildWhatsAppCaption(params: {
  tournamentName: string;
  clubName?: string | null;
  registrationUrl: string;
  dateLabel?: string;
}): string {
  const lines = [
    `🏆 ${params.tournamentName}`,
    params.clubName ? `📍 ${params.clubName}` : null,
    params.dateLabel ? `📅 ${params.dateLabel}` : null,
    '',
    'Inscrições abertas:',
    params.registrationUrl,
  ].filter((l) => l !== null) as string[];
  return lines.join('\n');
}
