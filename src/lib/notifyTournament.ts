import { supabase } from './supabase';

export type NotifyTournamentOptions = {
  tournamentId: string;
  /** Bypass already_sent and use resend copy + level filter */
  forceResend?: boolean;
};

export type NotifyTournamentResult = {
  ok: boolean;
  notified?: number;
  details?: Array<Record<string, unknown>>;
  error?: string;
  message?: string;
};

/** Fire-and-forget push for new/updated tournament (Player app). */
export async function notifyTournamentPlayers(
  opts: NotifyTournamentOptions,
): Promise<NotifyTournamentResult> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rqiwnxcexsccguruiteq.supabase.co';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  const { data: { session } } = await supabase.auth.getSession();

  const res = await fetch(`${supabaseUrl}/functions/v1/notify-new-tournament`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      tournamentId: opts.tournamentId,
      forceResend: !!opts.forceResend,
    }),
  });

  const body = await res.json().catch(() => ({}));
  return {
    ok: !!body.ok,
    notified: body.notified,
    details: body.details,
    error: body.error,
    message: body.message,
  };
}
