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
  format: 'single_elimination' | 'round_robin' | 'groups_knockout' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs_teams' | 'mixed_american' | 'ladder' | 'swiss_teams' | 'club_league';
  round_robin_type?: 'teams' | 'individual';
  max_teams: number;
  number_of_courts?: number;
  number_of_groups?: number;
  swiss_rounds?: number | null;
  category?: string;
  match_duration_minutes?: number;
  image_url?: string;
  user_id?: string;
  teams_per_group?: number;
  qualified_per_group?: number;
  daily_start_time?: string;
  daily_end_time?: string;
  daily_schedules?: DailyScheduleEntry[];
  qualified_teams_per_group?: number;
  knockout_stage?: string;
  allow_public_registration?: boolean;
  registration_code?: string;
  registration_deadline?: string;
  registration_fee?: number;
  member_price?: number;
  non_member_price?: number;
  allow_club_payment?: boolean;
  mixed_knockout?: boolean;
  club_id?: string;
  /** When set (e.g. ladder), all host club UUIDs; first should match club_id. */
  club_ids?: string[] | null;
  court_names?: string[];
  has_dinner_option?: boolean;
  /** level = auto CS by rating; manual = organizer order */
  seed_mode?: 'level' | 'manual' | null;
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
  player_account_id?: string | null;
  payment_status?: 'pending' | 'paid' | 'exempt';
  payment_transaction_id?: string | null;
  final_position?: number | null;
  group_name?: string | null;
  seed?: number | null;
  wants_dinner?: boolean;
  created_at: string;
};

export type DailyScheduleEntry = {
  date: string;
  start_time: string;
  end_time: string;
  court_names?: string[];
};

export type CategoryScheduleEntry = {
  date: string;       // e.g. "2026-04-05"
  start_time: string; // e.g. "09:00"
  end_time: string;   // e.g. "13:00"
};

export type TournamentCategory = {
  id: string;
  tournament_id: string;
  name: string;
  format?: string;
  number_of_groups: number;
  max_teams: number;
  registration_fee?: number;
  member_price?: number;
  non_member_price?: number;
  knockout_stage?: 'round_of_16' | 'quarterfinals' | 'semifinals' | 'final';
  qualified_per_group?: number;
  swiss_rounds?: number | null;
  game_format?: '1set' | '3sets' | '2sets_stb'; // 1 set | melhor de 3 | melhor de 2 + super TB
  court_names?: string[] | null;
  category_schedule?: CategoryScheduleEntry[] | null; // Schedule per category (day/time)
  match_duration_minutes?: number | null; // Per-category match duration (overrides tournament default)
  accepted_levels?: string[] | null;
  min_level?: number | null;
  max_level?: number | null;
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
  registration_source?: string | null;
  partner_match_invite_id?: string | null;
  organizer_review_status?: 'pending' | 'confirmed' | null;
  created_at: string;
};

export type Match = {
  id: string;
  tournament_id: string;
  team1_id: string | null;
  team2_id: string | null;
  player1_individual_id?: string | null;
  player2_individual_id?: string | null;
  player3_individual_id?: string | null;
  player4_individual_id?: string | null;
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

export type ClubLeaguePlayer = {
  id: string;
  team_id: string;
  player_account_id: string | null;
  name: string;
  email: string | null;
  phone_number: string | null;
  fpp_points: number;
  is_captain: boolean;
  player_order: number;
  created_at: string;
};

export type ClubLeagueTeam = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  club_id: string | null;
  name: string;
  captain_player_id: string | null;
  registration_order: number;
  created_at: string;
  updated_at: string;
  club_league_players?: ClubLeaguePlayer[];
};

export type ClubLeagueMatchday = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  matchday_number: number;
  matchday_date: string | null;
  label: string | null;
  leg: 'home' | 'away';
  created_at: string;
};

export type ClubLeagueConfrontation = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  matchday_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  scheduled_time: string | null;
  venue: string | null;
  court_name: string | null;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  winner_team_id: string | null;
  home_duos_won: number;
  away_duos_won: number;
  home_sets_won: number;
  away_sets_won: number;
  created_at: string;
  updated_at: string;
};

export type ClubLeagueLineup = {
  id: string;
  confrontation_id: string;
  team_id: string;
  duo1_player1_id: string | null;
  duo1_player2_id: string | null;
  duo2_player1_id: string | null;
  duo2_player2_id: string | null;
  duo3_player1_id: string | null;
  duo3_player2_id: string | null;
  submitted_at: string | null;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClubLeagueGame = {
  id: string;
  confrontation_id: string;
  game_type: 'duo1' | 'duo2' | 'duo3';
  game_order: number;
  home_set1: number | null;
  away_set1: number | null;
  home_set2: number | null;
  away_set2: number | null;
  home_stb: number | null;
  away_stb: number | null;
  winner_team_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ClubLeagueStanding = {
  id: string;
  tournament_id: string;
  category_id: string | null;
  team_id: string;
  played: number;
  won: number;
  lost: number;
  sets_won: number;
  sets_lost: number;
  sets_diff: number;
  points: number;
  position: number | null;
  created_at: string;
  updated_at: string;
};
