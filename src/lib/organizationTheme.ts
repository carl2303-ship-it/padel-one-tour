import { boostpadelSupabase, Organization } from './boostpadelSupabase';

export type ThemeBrand = 'boost' | 'padel1';

const RESERVED_PATHS = new Set([
  'tournament',
  'register',
  'login',
  'assets',
  'api',
  'service-worker.js',
  'manifest.json',
]);

export const BRAND_LOGOS: Record<ThemeBrand, string> = {
  boost:
    'https://rqiwnxcexsccguruiteq.supabase.co/storage/v1/object/sign/Logos/Boostpadel-logo.png?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV81OWQyMTAwNy1kOWY2LTQwZjktYWY4NC02MDBlZDJkZGQ0MTkiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJMb2dvcy9Cb29zdHBhZGVsLWxvZ28ucG5nIiwiaWF0IjoxNzY5NjAzMDg5LCJleHAiOjIwODQ5NjMwODl9.NZ_fLlxEIFXTHM3PyKW-UJa-YF32fdVTqkLJrbGXhg0',
  padel1:
    'https://rqiwnxcexsccguruiteq.supabase.co/storage/v1/object/public/Logos/padel-one-logo.png',
};

let cachedOrganization: Organization | null = null;
let cachedBrand: ThemeBrand | null = null;

export function extractTenantSlug(): string | null {
  const segment = window.location.pathname.split('/').filter(Boolean)[0];
  if (!segment || RESERVED_PATHS.has(segment)) return null;
  return segment.toLowerCase();
}

export function getDefaultBrandFromHost(): ThemeBrand {
  const host = window.location.hostname.toLowerCase();
  if (host.includes('boostpadel')) return 'boost';
  return 'padel1';
}

function darkenHex(hex: string, amount = 0.12): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return hex;
  const r = Math.max(0, Math.round(parseInt(normalized.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(normalized.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(normalized.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function applyOrganizationColors(org: Organization | null, brand: ThemeBrand) {
  const root = document.documentElement;

  if (org?.primary_color) {
    root.style.setProperty('--brand-primary', org.primary_color);
    root.style.setProperty('--brand-primary-hover', darkenHex(org.primary_color));
  } else {
    root.style.removeProperty('--brand-primary');
    root.style.removeProperty('--brand-primary-hover');
  }

  if (org?.accent_color) {
    root.style.setProperty('--brand-accent', org.accent_color);
  } else {
    root.style.removeProperty('--brand-accent');
  }

  root.dataset.customColors = org?.primary_color ? 'true' : 'false';
  root.dataset.brand = brand;
}

export function applyThemeBrand(brand: ThemeBrand) {
  document.documentElement.classList.remove('theme-boost', 'theme-padel1');
  document.documentElement.classList.add(brand === 'boost' ? 'theme-boost' : 'theme-padel1');
  document.documentElement.dataset.brand = brand;
  cachedBrand = brand;
}

export function getActiveBrand(): ThemeBrand {
  return cachedBrand || getDefaultBrandFromHost();
}

export function getActiveOrganization(): Organization | null {
  return cachedOrganization;
}

export function getBrandLogoUrl(brand?: ThemeBrand): string {
  return BRAND_LOGOS[brand || getActiveBrand()];
}

export async function initializeOrganizationTheme(): Promise<{
  org: Organization | null;
  brand: ThemeBrand;
}> {
  const slug = extractTenantSlug();
  let brand = getDefaultBrandFromHost();
  let org: Organization | null = null;

  if (slug) {
    const { data, error } = await boostpadelSupabase
      .from('organizations')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (!error && data) {
      org = data as Organization;
      brand = org.source === 'boost' ? 'boost' : 'padel1';

      if (org.language) {
        localStorage.setItem('preferred-language', org.language);
      }
    }
  }

  cachedOrganization = org;
  applyThemeBrand(brand);
  applyOrganizationColors(org, brand);
  return { org, brand };
}
