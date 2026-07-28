import { createClient } from '@supabase/supabase-js';

const boostpadelUrl =
  import.meta.env.VITE_BOOSTPADEL_SUPABASE_URL ||
  'https://gmpyjnufuvsoewbtirsg.supabase.co';

const boostpadelAnonKey =
  import.meta.env.VITE_BOOSTPADEL_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtcHlqbnVmdXZzb2V3YnRpcnNnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA0NjQ0NTYsImV4cCI6MjA3NjA0MDQ1Nn0.Uoe0xGYkQteD0nnHxeM5euGvBdeMbD64VbhBFQcGkX8';

export const boostpadelSupabase = createClient(boostpadelUrl, boostpadelAnonKey);

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
