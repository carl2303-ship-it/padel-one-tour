import { boostpadelSupabase, Organization } from './boostpadelSupabase';
import { supabase } from './supabase';

const BOOST_URL = import.meta.env.VITE_BOOSTPADEL_SUPABASE_URL
  || 'https://gmpyjnufuvsoewbtirsg.supabase.co';
const BOOST_ANON = import.meta.env.VITE_BOOSTPADEL_SUPABASE_ANON_KEY || '';

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

  const resp = await fetch(`${BOOST_URL}/functions/v1/manage-saas-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: BOOST_ANON,
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

  const resp = await fetch(`${BOOST_URL}/functions/v1/manage-saas-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey: BOOST_ANON,
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
