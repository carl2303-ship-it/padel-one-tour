import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Database features will not work.');
}

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder');

export type Tournament = {
  id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  start_time?: string;
  end_time?: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  format: 'single_elimination' | 'round_robin' | 'groups_knockout' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs' | 'mixed_gender' | 'mixed_american';
  round_robin_type?: 'teams' | 'individual';
  max_teams: number;
  number_of_courts?: number;
  number_of_groups?: number;
  category?: string;
  match_duration_minutes?: number;
  image_url?: string;
  user_id?: string;
  teams_per_group?: number;
  qualified_per_group?: number;
  daily_start_time?: string;
  daily_end_time?: string;
  daily_schedules?: any[];
  qualified_teams_per_group?: number;
  knockout_stage?: string;
  allow_public_registration?: boolean;
  registration_code?: string;
  registration_deadline?: string;
  registration_fee?: number;
  mixed_knockout?: boolean;
  club_id?: string;
  court_names?: string[];
  created_at: string;
  updated_at: string;
};

export type Player = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  phone_number?: string | null;
  skill_level?: 'beginner' | 'intermediate' | 'advanced' | 'professional';
  user_id?: string | null;
  tournament_id?: string | null;
  category_id?: string | null;
  payment_status?: 'pending' | 'paid' | 'exempt';
  payment_transaction_id?: string | null;
  final_position?: number | null;
  group_name?: string | null;
  seed?: number | null;
  created_at: string;
};

export type TournamentCategory = {
  id: string;
  tournament_id: string;
  name: string;
  format: 'single_elimination' | 'groups_knockout' | 'round_robin' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs' | 'mixed_gender' | 'mixed_american';
  number_of_groups: number;
  max_teams: number;
  registration_fee?: number;
  knockout_stage?: 'round_of_16' | 'quarterfinals' | 'semifinals' | 'final';
  qualified_per_group?: number;
  game_format?: '1set' | '3sets'; // Formato dos jogos: 1 set ou melhor de 3
  created_at: string;
};

export type Team = {
  id: string;
  tournament_id: string;
  name: string;
  player1_id: string;
  player2_id: string;
  seed: number | null;
  status?: string;
  placement?: number;
  category_id?: string | null;
  created_at: string;
};

export type Match = {
  id: string;
  tournament_id: string;
  team1_id: string | null;
  team2_id: string | null;
  player1_individual_id?: string | null;
  player2_individual_id?: string | null;
  round: string;
  match_number: number;
  scheduled_time: string | null;
  court: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  team1_score_set1: number;
  team2_score_set1: number;
  team1_score_set2: number;
  team2_score_set2: number;
  team1_score_set3: number;
  team2_score_set3: number;
  winner_id: string | null;
  category_id?: string | null;
  created_at: string;
  updated_at: string;
};
