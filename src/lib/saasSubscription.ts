import { boostpadelSupabase, Organization } from './boostpadelSupabase';
import { supabase } from './supabase';

const SE_SUPABASE_URL = 'https://tprbpeacicadsbmvxcqk.supabase.co';
const LEGACY_BOOST_HOST = 'gmpyjnufuvsoewbtirsg.supabase.co';
const SE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcmJwZWFjaWNhZHNibXZ4Y3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0MzkzODQsImV4cCI6MjEwMjAxNTM4NH0.HS263wYpOafjWdEFiA7NiSc2HxjgcEGG-bLP4FGvP78';

/** Edge SaaS — canónico SE; `VITE_BOOSTPADEL_*` override (host Boost legado → SE). */
function resolveSaasEdgeUrl(): string {
  const raw = import.meta.env.VITE_BOOSTPADEL_SUPABASE_URL || SE_SUPABASE_URL;
  if (raw.includes(LEGACY_BOOST_HOST)) return SE_SUPABASE_URL;
  return raw.replace(/\/$/, '');
}

const SAAS_EDGE_URL = resolveSaasEdgeUrl();

const SAAS_EDGE_ANON = (() => {
  const raw = import.meta.env.VITE_BOOSTPADEL_SUPABASE_ANON_KEY || SE_ANON_KEY;
  // JWT Boost legado tem ref gmpyjn… (base64 `ImdtcHlq…`) — forçar anon SE.
  if (raw.includes('ImdtcHlqbnVmdXZzb2V3YnRpcnNn') || raw.includes('gmpyjnufuvsoewbtirsg')) {
    return SE_ANON_KEY;
  }
  return raw;
})();

export type SaasSubscriptionInfo = Organization & {
  cancel_at_period_end?: boolean;
};

export async function loadSaasSubscription(userId: string): Promise<SaasSubscriptionInfo | null> {
  const { data, error } = await boostpadelSupabase
    .from('organizations')
    .select('*')
    .eq('tour_user_id', userId)
    .eq('source', 'boost')
    .maybeSingle();

  if (error || !data) return null;
  return data as SaasSubscriptionInfo;
}

export async function cancelSubscriptionAtPeriodEnd(): Promise<{ message: string; subscription_expires_at?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

  const resp = await fetch(`${SAAS_EDGE_URL}/functions/v1/manage-saas-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SAAS_EDGE_ANON,
    },
    body: JSON.stringify({ action: 'cancel_at_period_end' }),
  });

  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Erro ao cancelar subscrição');
  return result;
}

export async function reactivateSubscription(): Promise<{ message: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');

  const resp = await fetch(`${SAAS_EDGE_URL}/functions/v1/manage-saas-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: SAAS_EDGE_ANON,
    },
    body: JSON.stringify({ action: 'reactivate' }),
  });

  const result = await resp.json();
  if (!resp.ok) throw new Error(result.error || 'Erro ao reativar subscrição');
  return result;
}

export function formatSubscriptionDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-PT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function planLabel(plan: string | null | undefined): string {
  const labels: Record<string, string> = {
    bronze: 'Bronze',
    silver: 'Silver',
    gold: 'Gold',
    platinum: 'Platinum',
  };
  return labels[plan?.toLowerCase() || ''] || plan || '—';
}

export function daysUntilExpiry(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}
