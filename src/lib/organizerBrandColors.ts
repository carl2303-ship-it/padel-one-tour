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
      const boostUrl = import.meta.env.VITE_BOOSTPADEL_SUPABASE_URL
        || 'https://gmpyjnufuvsoewbtirsg.supabase.co';
      const boostAnon = import.meta.env.VITE_BOOSTPADEL_SUPABASE_ANON_KEY || '';

      const resp = await fetch(`${boostUrl}/functions/v1/sync-org-branding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: boostAnon,
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
