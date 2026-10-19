import { supabase } from './supabase';

const BUCKET = 'tournament-images';
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;

/**
 * Extract storage object path from a tournament-images public URL.
 * Skips club/organizer logos stored under logos/ in the same bucket.
 */
export function tournamentImageStoragePath(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  const raw = String(imageUrl).trim();
  if (!raw) return null;

  let path: string | null = null;
  const publicIdx = raw.indexOf(PUBLIC_MARKER);
  if (publicIdx >= 0) {
    path = raw.slice(publicIdx + PUBLIC_MARKER.length);
  } else {
    const m = raw.match(/tournament-images\/(.+)$/i);
    if (m) path = m[1];
  }
  if (!path) return null;

  path = decodeURIComponent(path.split('?')[0].split('#')[0]);
  if (!path || path.startsWith('logos/')) return null;
  return path;
}

/** Delete tournament photo from Storage (no-op for logos/ or unknown URLs). */
export async function deleteTournamentImage(
  imageUrl: string | null | undefined
): Promise<{ deleted: boolean; path: string | null; error?: string }> {
  const path = tournamentImageStoragePath(imageUrl);
  if (!path) return { deleted: false, path: null };

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    console.error('[tournamentImageStorage] remove failed:', path, error.message);
    return { deleted: false, path, error: error.message };
  }
  return { deleted: true, path };
}
