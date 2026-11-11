import { createClient } from '@supabase/supabase-js';

/** SportsEvents — dados SaaS/loja no schema `boost`. */
const SE_SUPABASE_URL = 'https://tprbpeacicadsbmvxcqk.supabase.co';
const LEGACY_BOOST_HOST = 'gmpyjnufuvsoewbtirsg.supabase.co';

const SE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcmJwZWFjaWNhZHNibXZ4Y3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MzkzODQsImV4cCI6MjEwMjAxNTM4NH0.HS263wYpOafjWdEFiA7NiSc2HxjgcEGG-bLP4FGvP78';

/**
 * URL do projecto onde vivem `organizations` (e resto SaaS).
 * Canónico: SportsEvents. Env legado `VITE_BOOSTPADEL_*` ainda funciona,
 * mas o host Boost é forçado para SE (dados já migrados para `boost.*`).
 */
function resolveSaasDataUrl(): string {
  const raw = import.meta.env.VITE_BOOSTPADEL_SUPABASE_URL || SE_SUPABASE_URL;
  if (raw.includes(LEGACY_BOOST_HOST)) return SE_SUPABASE_URL;
  return raw.replace(/\/$/, '');
}

const boostpadelUrl = resolveSaasDataUrl();

const boostpadelAnonKey = (() => {
  const raw = import.meta.env.VITE_BOOSTPADEL_SUPABASE_ANON_KEY || SE_ANON_KEY;
  // JWT Boost legado (ref gmpyjn…) → anon SE.
  if (raw.includes('ImdtcHlqbnVmdXZzb2V3YnRpcnNn') || raw.includes('gmpyjnufuvsoewbtirsg')) {
    return SE_ANON_KEY;
  }
  return raw;
})();

/** Cliente anon → PostgREST schema `boost` no SE (`boost.organizations`, …). */
export const boostpadelSupabase = createClient(boostpadelUrl, boostpadelAnonKey, {
  db: { schema: 'boost' },
});

export type Organization = {
  id: string;
  name: string;
  slug: string;
  source: 'boost' | 'padel1' | string;
  plan_type: string;
  status: string;
  currency: string;
  language: string;
  owner_email: string | null;
  max_tournaments: number | null;
  stripe_subscription_id: string | null;
  contract_start: string | null;
  subscription_expires_at: string | null;
  primary_color: string | null;
  accent_color: string | null;
  tour_user_id: string | null;
  cancel_at_period_end?: boolean;
};
