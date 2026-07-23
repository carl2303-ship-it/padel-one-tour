import { useEffect, useState } from 'react';
import { supabase, type Tournament } from '../lib/supabase';
import RegistrationLanding from './RegistrationLanding';
import SuperTeamRegistration from './SuperTeamRegistration';
import { Trophy } from 'lucide-react';

/**
 * Lightweight public registration entry (?register=id).
 * Bypasses organizer license/module gates in App so players can always open the link.
 */
export default function PublicRegistrationPage() {
  const tournamentId = new URLSearchParams(window.location.search).get('register');
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!tournamentId) {
        setError('Link de inscrição inválido.');
        setLoading(false);
        return;
      }

      try {
        const { data } = await supabase
          .from('tournaments')
          .select('*')
          .eq('id', tournamentId)
          .maybeSingle();

        if (cancelled) return;

        if (data) {
          setTournament(data as Tournament);
          setError(null);
          setLoading(false);
          return;
        }

        const { data: rpcTournament, error: rpcError } = await supabase.rpc('get_public_tournament', {
          p_tournament_id: tournamentId,
        });

        if (cancelled) return;

        if (rpcError) {
          console.error('[PublicRegistration] RPC error:', rpcError);
        }

        if (rpcTournament && typeof rpcTournament === 'object' && (rpcTournament as { id?: string }).id) {
          setTournament(rpcTournament as Tournament);
          setError(null);
        } else {
          setError('Torneio não encontrado ou inscrições não estão abertas.');
        }
      } catch (err) {
        console.error('[PublicRegistration] load error:', err);
        if (!cancelled) {
          setError('Não foi possível carregar o torneio. Tente novamente.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [tournamentId]);

  const handleClose = () => {
    const redirect = (tournament as any)?.registration_redirect_url || 'https://padel1.app';
    window.location.href = redirect;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">A carregar inscrição...</p>
        </div>
      </div>
    );
  }

  if (error || !tournament) {
    return (
      <div className="min-h-screen bg-[#f7f7f7] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <Trophy className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Link indisponível</h2>
          <p className="text-sm text-gray-600 mb-6">
            {error || 'Torneio não encontrado ou inscrições não estão abertas.'}
          </p>
          <a
            href="https://padel1.app"
            className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Ir para Padel1
          </a>
        </div>
      </div>
    );
  }

  if (tournament.format === 'super_teams') {
    return <SuperTeamRegistration tournament={tournament} onClose={handleClose} />;
  }

  return <RegistrationLanding tournament={tournament} onClose={handleClose} />;
}
