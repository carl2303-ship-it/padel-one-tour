import { boostpadelSupabase, Organization } from './boostpadelSupabase';
import { supabase } from './supabase';
import {
  applyOrganizationColors,
  applyThemeBrand,
  getActiveBrand,
  getDefaultBrandFromHost,
  type ThemeBrand,
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

export async function loadOrganizerBrandColors(userId: string): Promise<BrandColorInput | null> {
  const { data: org } = await boostpadelSupabase
    .from('organizations')
    .select('primary_color, accent_color, source')
    .eq('tour_user_id', userId)
    .maybeSingle();

  if (org?.primary_color || org?.accent_color) {
    const brand: ThemeBrand = org.source === 'boost' ? 'boost' : 'padel1';
    applyThemeBrand(brand);
    applyOrganizationColors(org as Organization, brand);
    return { primary_color: org.primary_color, accent_color: org.accent_color };
  }

  const { data: settings } = await supabase
    .from('user_logo_settings')
    .select('primary_color, accent_color')
    .eq('user_id', userId)
    .maybeSingle();

  if (settings?.primary_color || settings?.accent_color) {
    applyOrganizationColors(settings as Organization, getActiveBrand() || getDefaultBrandFromHost());
    return settings;
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

  if (existing) {
    await supabase.from('user_logo_settings').update(payload).eq('user_id', userId);
  } else {
    await supabase.from('user_logo_settings').insert({
      user_id: userId,
      role: 'organizer',
      logo_url: null,
      ...payload,
    });
  }

  applyOrganizationColors(
    { primary_color: primary, accent_color: accent } as Organization,
    getActiveBrand() || getDefaultBrandFromHost(),
  );

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
