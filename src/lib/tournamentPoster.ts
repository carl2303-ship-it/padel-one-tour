import type { Tournament, TournamentCategory } from './supabase';
import {
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
  /** Free-text: what the fee includes (balls, dinner, t-shirt…) — fallback if description empty */
  includes?: string | null;
  /** Tournament settings description (HTML/plain): format, prizes, includes… */
  description?: string | null;
  /** Public registration URL (QR + caption). Images themselves are not clickable on WhatsApp. */
  registrationUrl?: string | null;
};

type DescRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean };
type DescLine = { runs: DescRun[]; bullet?: boolean; spacer?: boolean };

/** Strip HTML from RichText description for canvas text (flat). */
export function plainTextFromDescription(html?: string | null): string {
  return descriptionLinesFromHtml(html)
    .map((l) => {
      if (l.spacer) return '';
      return l.bullet ? `• ${l.runs.map((r) => r.text).join('')}` : l.runs.map((r) => r.text).join('');
    })
    .join('\n')
    .trim();
}

/** Parse RichText HTML into lines preserving breaks, blank lines, lists, bold/italic/underline. */
export function descriptionLinesFromHtml(html?: string | null): DescLine[] {
  if (!html || !html.trim()) return [];

  const root = document.createElement('div');
  root.innerHTML = html;

  const lines: DescLine[] = [];
  let current: DescRun[] = [];
  let bullet = false;

  const isEmptyLine = (l: DescLine) =>
    !!l.spacer || (!l.bullet && !l.runs.some((r) => r.text.trim()));

  const pushSpacer = () => {
    // Keep at most one blank line in a row, but always allow interline gaps
    if (lines.length === 0) return;
    if (isEmptyLine(lines[lines.length - 1])) return;
    lines.push({ runs: [{ text: '' }], spacer: true });
  };

  const flush = (opts?: { forceEmpty?: boolean }) => {
    const text = current.map((r) => r.text).join('');
    const hasContent = Boolean(text.trim()) || bullet;
    if (hasContent) {
      lines.push({
        runs: current.length ? current : [{ text: '' }],
        bullet,
      });
    } else if (opts?.forceEmpty) {
      pushSpacer();
    }
    current = [];
    bullet = false;
  };

  const pushRun = (text: string, style: { bold?: boolean; italic?: boolean; underline?: boolean }) => {
    const cleaned = text.replace(/\u00a0/g, ' ');
    if (!cleaned) return;
    const last = current[current.length - 1];
    if (
      last &&
      !!last.bold === !!style.bold &&
      !!last.italic === !!style.italic &&
      !!last.underline === !!style.underline
    ) {
      last.text += cleaned;
    } else {
      current.push({ text: cleaned, ...style });
    }
  };

  const walk = (
    node: Node,
    style: { bold?: boolean; italic?: boolean; underline?: boolean }
  ) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const raw = node.textContent || '';
      // Preserve intentional newlines inside text nodes
      const parts = raw.split(/\n/);
      parts.forEach((part, i) => {
        if (i > 0) flush({ forceEmpty: true });
        pushRun(part, style);
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      flush({ forceEmpty: true });
      return;
    }

    const nextStyle = {
      bold: style.bold || tag === 'b' || tag === 'strong',
      italic: style.italic || tag === 'i' || tag === 'em',
      underline: style.underline || tag === 'u',
    };

    if (tag === 'li') {
      flush();
      bullet = true;
      Array.from(el.childNodes).forEach((c) => walk(c, nextStyle));
      flush();
      return;
    }

    if (tag === 'p' || tag === 'div' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
      if (current.length) flush();
      // Empty <p><br></p> / <p></p> → blank line (interlinha)
      const before = lines.length;
      Array.from(el.childNodes).forEach((c) => walk(c, nextStyle));
      const produced = lines.length > before || current.some((r) => r.text.trim());
      if (!produced) {
        flush({ forceEmpty: true });
      } else {
        flush();
        // Extra gap after each block paragraph for visual interline
        pushSpacer();
      }
      return;
    }

    if (tag === 'ul' || tag === 'ol') {
      if (current.length) flush();
      Array.from(el.childNodes).forEach((c) => walk(c, nextStyle));
      pushSpacer();
      return;
    }

    Array.from(el.childNodes).forEach((c) => walk(c, nextStyle));
  };

  Array.from(root.childNodes).forEach((c) => walk(c, {}));
  if (current.length) flush();

  // Drop trailing blank lines only
  while (lines.length && isEmptyLine(lines[lines.length - 1])) {
    lines.pop();
  }
  return lines;
}

function fontForRun(size: number, run: DescRun): string {
  const weight = run.bold ? '800' : '600';
  const style = run.italic ? 'italic ' : '';
  return `${style}${weight} ${size}px Inter, system-ui, sans-serif`;
}

/** Draw rich description lines with wrapping; returns height used. */
function drawDescriptionLines(
  ctx: CanvasRenderingContext2D,
  lines: DescLine[],
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
  fontSize: number
): number {
  let drawn = 0;
  let cursorY = y;

  for (const line of lines) {
    if (drawn >= maxLines) break;

    // Blank interline (paragraph gap)
    if (line.spacer || (!line.bullet && !line.runs.some((r) => r.text.trim()))) {
      cursorY += Math.round(lineHeight * 0.65);
      drawn += 1;
      continue;
    }

    const prefix = line.bullet ? '•  ' : '';
    const prefixW = line.bullet
      ? (() => {
          ctx.font = fontForRun(fontSize, { text: '', bold: true });
          return ctx.measureText(prefix).width;
        })()
      : 0;

    // Flatten runs into wrapped visual lines
    type Piece = { text: string; run: DescRun };
    const pieces: Piece[] = [];
    for (const run of line.runs) {
      const words = run.text.split(/(\s+)/);
      for (const w of words) {
        if (w) pieces.push({ text: w, run });
      }
    }

    let row: Piece[] = [];
    let rowW = prefixW;

    const paintRow = (parts: Piece[], isFirst: boolean) => {
      if (drawn >= maxLines) return;
      let cx = x;
      if (isFirst && line.bullet) {
        ctx.font = fontForRun(fontSize, { text: '', bold: true });
        ctx.fillStyle = '#ffffff';
        ctx.fillText(prefix, cx, cursorY);
        cx += prefixW;
      }
      for (const p of parts) {
        ctx.font = fontForRun(fontSize, p.run);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(p.text, cx, cursorY);
        if (p.run.underline) {
          const tw = ctx.measureText(p.text).width;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, cursorY + 4);
          ctx.lineTo(cx + tw, cursorY + 4);
          ctx.stroke();
        }
        cx += ctx.measureText(p.text).width;
      }
      cursorY += lineHeight;
      drawn += 1;
    };

    if (pieces.length === 0) {
      paintRow([], true);
      continue;
    }

    let first = true;
    for (const piece of pieces) {
      ctx.font = fontForRun(fontSize, piece.run);
      const w = ctx.measureText(piece.text).width;
      if (row.length && rowW + w > maxWidth && !/^\s+$/.test(piece.text)) {
        paintRow(row, first);
        first = false;
        row = [];
        rowW = prefixW;
        if (drawn >= maxLines) break;
      }
      row.push(piece);
      rowW += w;
    }
    if (row.length && drawn < maxLines) paintRow(row, first);
  }

  return cursorY - y;
}

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

function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatDateWithWeekday(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return '';
  const weekday = d.toLocaleDateString('pt-PT', { weekday: 'long' });
  const cap = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${cap} ${dd}/${mm}/${yyyy}`;
}

function formatDateLabel(startDate: string, endDate?: string | null): string {
  const startLabel = formatDateWithWeekday(startDate);
  if (!startLabel) return '';
  if (!endDate || endDate === startDate) return startLabel;
  const endLabel = formatDateWithWeekday(endDate);
  if (!endLabel) return startLabel;
  return `${startLabel} – ${endLabel}`;
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
  const pad = 52;
  let y = 32;

  // —— Large centered club logo ——
  const logoSize = 180;
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
  y += logoSize + 12;

  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '700 20px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CLUBE', POSTER_WIDTH / 2, y);
  y += 30;
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 36px Inter, system-ui, sans-serif';
  const clubH = wrapText(
    ctx,
    input.clubName?.trim() || 'Padel One',
    pad,
    y,
    POSTER_WIDTH - pad * 2,
    40,
    2,
    'center'
  );
  ctx.textAlign = 'left';
  y += clubH + 14;

  // Accent
  roundRect(ctx, (POSTER_WIDTH - 100) / 2, y, 100, 7, 4);
  ctx.fillStyle = theme.accent;
  ctx.fill();
  y += 30;

  ctx.fillStyle = theme.accentSoft;
  ctx.font = '800 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('TORNEIO', POSTER_WIDTH / 2, y);
  y += 38;

  ctx.fillStyle = '#ffffff';
  ctx.font = '900 48px Inter, system-ui, sans-serif';
  const titleH = wrapText(
    ctx,
    input.tournamentName.trim() || 'Torneio',
    pad,
    y,
    POSTER_WIDTH - pad * 2,
    52,
    2,
    'center'
  );
  ctx.textAlign = 'left';
  y += titleH + 18;

  // —— Categories + levels (right after title, larger) ——
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '800 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('CATEGORIAS · NÍVEIS PADEL1', POSTER_WIDTH / 2, y);
  ctx.textAlign = 'left';
  y += 14;

  const cats = input.categories.length > 0 ? input.categories : [{ name: 'Open' }];
  const footerReserve = input.registrationUrl ? 190 : 60;
  const maxY = POSTER_HEIGHT - footerReserve;
  const catRowH = 88;
  // Reserve room below for date/price/description (~280px)
  const catBudget = Math.min(maxY - y - 280, cats.length * catRowH);
  const maxCats = Math.max(1, Math.floor(Math.max(catBudget, catRowH) / catRowH));
  const visibleCats = cats.slice(0, maxCats);

  for (const cat of visibleCats) {
    y += 14;
    roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, 74, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 34px Inter, system-ui, sans-serif';
    ctx.fillText(cat.name, pad + 26, y + 46);

    const levels = levelsForCategory(cat);
    let chipX = POSTER_WIDTH - pad - 26;
    ctx.font = '900 24px Inter, system-ui, sans-serif';
    for (let i = levels.length - 1; i >= 0; i--) {
      const code = levels[i];
      const tw = ctx.measureText(code).width + 28;
      chipX -= tw;
      roundRect(ctx, chipX, y + 16, tw, 42, 12);
      ctx.fillStyle = colorForLevel(code);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(code, chipX + 14, y + 45);
      chipX -= 10;
    }
    if (levels.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '700 22px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Todos os níveis', POSTER_WIDTH - pad - 26, y + 46);
      ctx.textAlign = 'left';
    }
    y += 74;
  }
  if (cats.length > visibleCats.length) {
    y += 10;
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 20px Inter, system-ui, sans-serif';
    ctx.fillText(`+${cats.length - visibleCats.length} categorias`, pad, y);
    y += 8;
  }
  y += 16;

  // Date / time
  const dateLabel = formatDateLabel(input.startDate, input.endDate);
  const timeLabel = formatTimeLabel(input.startTime, input.endTime);
  const dateCardH = 88;
  roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, dateCardH, 18);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = '700 16px Inter, system-ui, sans-serif';
  ctx.fillText('DATA', pad + 26, y + 28);
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 30px Inter, system-ui, sans-serif';
  ctx.fillText(dateLabel || '—', pad + 26, y + 62);
  if (timeLabel) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.fillText('HORA', pad + 520, y + 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 30px Inter, system-ui, sans-serif';
    ctx.fillText(timeLabel, pad + 520, y + 62);
  }
  y += dateCardH + 14;

  // Price
  const member = formatEuro(input.memberPrice);
  const nonMember = formatEuro(input.nonMemberPrice);
  if (member || nonMember) {
    roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, 78, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.fillText('PREÇO', pad + 26, y + 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 28px Inter, system-ui, sans-serif';
    const priceLine =
      member && nonMember && member !== nonMember
        ? `Membros ${member}  ·  Não-membros ${nonMember}`
        : member || nonMember || '';
    ctx.fillText(priceLine, pad + 26, y + 60);
    y += 90;
  }

  // Description from settings — keep RichText structure (breaks, lists, bold/italic)
  let descLines = descriptionLinesFromHtml(input.description);
  if (descLines.length === 0 && (input.includes || '').trim()) {
    descLines = [{ runs: [{ text: (input.includes || '').trim() }] }];
  }
  if (descLines.length > 0) {
    const descMaxH = Math.max(80, maxY - y - 8);
    const fontSize = 24;
    const lineH = 30;
    const headerH = 36;
    const maxLines = Math.max(2, Math.floor((descMaxH - headerH - 12) / lineH));

    // Offscreen measure: draw to temp then copy — simpler: estimate lines * lineH
    const estimated = Math.min(
      maxLines,
      Math.max(
        descLines.length,
        descLines.reduce((acc, l) => {
          const plain = (l.bullet ? '•  ' : '') + l.runs.map((r) => r.text).join('');
          ctx.font = fontForRun(fontSize, { text: '', bold: true });
          const charsPerLine = Math.max(20, Math.floor((POSTER_WIDTH - pad * 2 - 52) / (fontSize * 0.55)));
          return acc + Math.max(1, Math.ceil(plain.length / charsPerLine));
        }, 0)
      )
    );
    const boxH = Math.min(descMaxH, headerH + estimated * lineH + 20);

    roundRect(ctx, pad, y, POSTER_WIDTH - pad * 2, boxH, 18);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.fillText('INFO · FORMATO · PRÉMIOS · INCLUI', pad + 26, y + 28);

    drawDescriptionLines(
      ctx,
      descLines,
      pad + 26,
      y + 58,
      POSTER_WIDTH - pad * 2 - 52,
      lineH,
      maxLines,
      fontSize
    );
    y += boxH + 10;
  }

  // Registration CTA: QR + pill (WA images aren't clickable — QR opens the link)
  if (input.registrationUrl) {
    const blockY = POSTER_HEIGHT - 186;
    const qrSize = 120;
    roundRect(ctx, pad, blockY, POSTER_WIDTH - pad * 2, 136, 20);
    ctx.fillStyle = 'rgba(0,0,0,0.40)';
    ctx.fill();
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    if (qr) {
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, pad + 16, blockY + 8, qrSize, qrSize, 12);
      ctx.fill();
      ctx.drawImage(qr, pad + 20, blockY + 12, qrSize - 8, qrSize - 8);
    }

    const pillX = pad + (qr ? qrSize + 32 : 24);
    const pillW = POSTER_WIDTH - pad - pillX - 24;
    const pillY = blockY + 24;
    const pillH = 52;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 24px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('INSCRIÇÃO ONLINE', pillX + pillW / 2, pillY + 34);
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    const shortUrl = input.registrationUrl.replace(/^https?:\/\//, '');
    wrapText(ctx, shortUrl, pillX, pillY + 80, pillW, 20, 2);
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
