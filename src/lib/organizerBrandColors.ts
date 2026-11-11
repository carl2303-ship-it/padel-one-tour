import { Organization } from './boostpadelSupabase';
import { supabase } from './supabase';
import {
  applyOrganizationColors,
  getActiveBrand,
  getActiveOrganization,
  getDefaultBrandFromHost,
} from './organizationTheme';

export type BrandColorInput = {
  primary_color?: string | null;
  accent_color?: string | null;
};

function normalizeHex(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^#[0-9A-Fa-f]{6}$/.test(trimmed) ? trimmed : null;
}

function applyLoadedColors(colors: BrandColorInput) {
  applyOrganizationColors(
    colors as Organization,
    getActiveBrand() || getDefaultBrandFromHost(),
  );
}

export async function loadOrganizerBrandColors(userId: string): Promise<BrandColorInput | null> {
  const { data: settings, error: settingsError } = await supabase
    .from('user_logo_settings')
    .select('primary_color, accent_color')
    .eq('user_id', userId)
    .maybeSingle();

  if (!settingsError && (settings?.primary_color || settings?.accent_color)) {
    applyLoadedColors(settings);
    return settings;
  }

  const cachedOrg = getActiveOrganization();
  if (cachedOrg?.primary_color || cachedOrg?.accent_color) {
    applyLoadedColors({
      primary_color: cachedOrg.primary_color,
      accent_color: cachedOrg.accent_color,
    });
    return {
      primary_color: cachedOrg.primary_color,
      accent_color: cachedOrg.accent_color,
    };
  }

  return null;
}

export async function saveOrganizerBrandColors(
  userId: string,
  colors: BrandColorInput,
): Promise<{ syncedToOrganization: boolean }> {
  const primary = normalizeHex(colors.primary_color);
  const accent = normalizeHex(colors.accent_color);

  const { data: existing } = await supabase
    .from('user_logo_settings')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const payload = {
    primary_color: primary,
    accent_color: accent,
    updated_at: new Date().toISOString(),
  };

  const writeResult = existing
    ? await supabase.from('user_logo_settings').update(payload).eq('user_id', userId)
    : await supabase.from('user_logo_settings').insert({
        user_id: userId,
        role: 'organizer',
        logo_url: null,
        ...payload,
      });

  if (writeResult.error) {
    throw new Error(writeResult.error.message);
  }

  applyLoadedColors({ primary_color: primary, accent_color: accent });

  let syncedToOrganization = false;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      // Edge sync — default SportsEvents; VITE_BOOSTPADEL_* override (Boost host → SE)
      const SE_URL = 'https://tprbpeacicadsbmvxcqk.supabase.co';
      const SE_ANON =
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcmJwZWFjaWNhZHNibXZ4Y3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MzkzODQsImV4cCI6MjEwMjAxNTM4NH0.HS263wYpOafjWdEFiA7NiSc2HxjgcEGG-bLP4FGvP78';
      const rawUrl = import.meta.env.VITE_BOOSTPADEL_SUPABASE_URL || SE_URL;
      const edgeUrl = rawUrl.includes('gmpyjnufuvsoewbtirsg.supabase.co')
        ? SE_URL
        : rawUrl.replace(/\/$/, '');
      let edgeAnon = import.meta.env.VITE_BOOSTPADEL_SUPABASE_ANON_KEY || SE_ANON;
      if (
        edgeAnon.includes('ImdtcHlqbnVmdXZzb2V3YnRpcnNn')
        || edgeAnon.includes('gmpyjnufuvsoewbtirsg')
      ) {
        edgeAnon = SE_ANON;
      }

      const resp = await fetch(`${edgeUrl}/functions/v1/sync-org-branding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: edgeAnon,
        },
        body: JSON.stringify({ primary_color: primary, accent_color: accent }),
      });

      const result = await resp.json();
      syncedToOrganization = resp.ok && !!result?.organization;
    }
  } catch (err) {
    console.warn('Could not sync brand colors to organization:', err);
  }

  return { syncedToOrganization };
}
