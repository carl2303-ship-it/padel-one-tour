import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Save, Trophy } from 'lucide-react';

type SuperTeamPlayer = {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  is_captain: boolean;
  player_order: number;
};

type SuperTeam = {
  id: string;
  name: string;
  category_id: string | null;
  super_team_players: SuperTeamPlayer[];
};

type Confrontation = {
  id: string;
  super_team_1_id: string | null;
  super_team_2_id: string | null;
  status: string;
  team1_matches_won: number;
  team2_matches_won: number;
  has_super_tiebreak: boolean;
  winner_super_team_id: string | null;
  next_confrontation_id?: string | null;
  next_team_slot?: number | null;
};

type Game = {
  id: string;
  confrontation_id: string;
  game_type: 'duo1' | 'duo2' | 'super_tiebreak';
  game_order: number;
  team1_score: number | null;
  team2_score: number | null;
  status: string;
};

type Props = {
  confrontation: Confrontation;
  team1: SuperTeam | null | undefined;
  team2: SuperTeam | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
};

export default function SuperTeamResultsModal({ confrontation, team1, team2, onClose, onSuccess }: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Scores para cada jogo
  const [duo1Team1Score, setDuo1Team1Score] = useState<number | ''>('');
  const [duo1Team2Score, setDuo1Team2Score] = useState<number | ''>('');
  const [duo2Team1Score, setDuo2Team1Score] = useState<number | ''>('');
  const [duo2Team2Score, setDuo2Team2Score] = useState<number | ''>('');
  const [tiebreakTeam1Score, setTiebreakTeam1Score] = useState<number | ''>('');
  const [tiebreakTeam2Score, setTiebreakTeam2Score] = useState<number | ''>('');

  useEffect(() => {
    fetchGames();
  }, [confrontation.id]);

  const ensureGames = async () => {
    const { data: existing } = await supabase
      .from('super_team_games')
      .select('id')
      .eq('confrontation_id', confrontation.id);
    if (existing && existing.length > 0) return;
    await supabase.from('super_team_games').insert([
      { confrontation_id: confrontation.id, game_type: 'duo1', game_order: 1 },
      { confrontation_id: confrontation.id, game_type: 'duo2', game_order: 2 },
      { confrontation_id: confrontation.id, game_type: 'super_tiebreak', game_order: 3 },
    ]);
  };

  const fetchGames = async () => {
    setLoading(true);
    try {
      await ensureGames();
      const { data, error } = await supabase
        .from('super_team_games')
        .select('*')
        .eq('confrontation_id', confrontation.id)
        .order('game_order');

      if (error) throw error;

      if (data) {
        setGames(data);
        // Preencher scores existentes
        data.forEach(game => {
          if (game.game_type === 'duo1') {
            setDuo1Team1Score(game.team1_score ?? '');
            setDuo1Team2Score(game.team2_score ?? '');
          } else if (game.game_type === 'duo2') {
            setDuo2Team1Score(game.team1_score ?? '');
            setDuo2Team2Score(game.team2_score ?? '');
          } else if (game.game_type === 'super_tiebreak') {
            setTiebreakTeam1Score(game.team1_score ?? '');
            setTiebreakTeam2Score(game.team2_score ?? '');
          }
        });
      }
    } catch (err) {
      console.error('Error fetching games:', err);
      setError('Erro ao carregar jogos');
    } finally {
      setLoading(false);
    }
  };

  const calculateResults = () => {
    let team1Wins = 0;
    let team2Wins = 0;
    let needsTiebreak = false;

    // Jogo 1 (Duo 1)
    if (duo1Team1Score !== '' && duo1Team2Score !== '') {
      if (Number(duo1Team1Score) > Number(duo1Team2Score)) team1Wins++;
      else if (Number(duo1Team2Score) > Number(duo1Team1Score)) team2Wins++;
    }

    // Jogo 2 (Duo 2)
    if (duo2Team1Score !== '' && duo2Team2Score !== '') {
      if (Number(duo2Team1Score) > Number(duo2Team2Score)) team1Wins++;
      else if (Number(duo2Team2Score) > Number(duo2Team1Score)) team2Wins++;
    }

    // Verificar se precisa de Super Tie-Break (1-1)
    needsTiebreak = team1Wins === 1 && team2Wins === 1;

    // Super Tie-Break
    if (needsTiebreak && tiebreakTeam1Score !== '' && tiebreakTeam2Score !== '') {
      if (Number(tiebreakTeam1Score) > Number(tiebreakTeam2Score)) team1Wins++;
      else if (Number(tiebreakTeam2Score) > Number(tiebreakTeam1Score)) team2Wins++;
    }

    return { team1Wins, team2Wins, needsTiebreak };
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');

    try {
      const { team1Wins, team2Wins, needsTiebreak } = calculateResults();

      // Atualizar jogos
      const duo1Game = games.find(g => g.game_type === 'duo1');
      const duo2Game = games.find(g => g.game_type === 'duo2');
      const tiebreakGame = games.find(g => g.game_type === 'super_tiebreak');

      if (duo1Game && duo1Team1Score !== '' && duo1Team2Score !== '') {
        const winnerId = Number(duo1Team1Score) > Number(duo1Team2Score)
          ? (team1?.id || null)
          : Number(duo1Team2Score) > Number(duo1Team1Score)
            ? (team2?.id || null)
            : null;
        await supabase.from('super_team_games').update({
          team1_score: String(duo1Team1Score),
          team2_score: String(duo1Team2Score),
          winner_super_team_id: winnerId,
          status: 'completed'
        }).eq('id', duo1Game.id);
      }

      if (duo2Game && duo2Team1Score !== '' && duo2Team2Score !== '') {
        const winnerId = Number(duo2Team1Score) > Number(duo2Team2Score)
          ? (team1?.id || null)
          : Number(duo2Team2Score) > Number(duo2Team1Score)
            ? (team2?.id || null)
            : null;
        await supabase.from('super_team_games').update({
          team1_score: String(duo2Team1Score),
          team2_score: String(duo2Team2Score),
          winner_super_team_id: winnerId,
          status: 'completed'
        }).eq('id', duo2Game.id);
      }

      if (tiebreakGame && needsTiebreak && tiebreakTeam1Score !== '' && tiebreakTeam2Score !== '') {
        const winnerId = Number(tiebreakTeam1Score) > Number(tiebreakTeam2Score)
          ? (team1?.id || null)
          : Number(tiebreakTeam2Score) > Number(tiebreakTeam1Score)
            ? (team2?.id || null)
            : null;
        await supabase.from('super_team_games').update({
          team1_score: String(tiebreakTeam1Score),
          team2_score: String(tiebreakTeam2Score),
          winner_super_team_id: winnerId,
          status: 'completed'
        }).eq('id', tiebreakGame.id);
      }

      // Determinar vencedor do confronto
      let winnerId = null;
      let status = 'scheduled';

      if (team1Wins === 2 || (needsTiebreak && team1Wins > team2Wins)) {
        winnerId = confrontation.super_team_1_id ?? null;
        status = 'completed';
      } else if (team2Wins === 2 || (needsTiebreak && team2Wins > team1Wins)) {
        winnerId = confrontation.super_team_2_id ?? null;
        status = 'completed';
      }

      // Atualizar confronto
      await supabase.from('super_team_confrontations').update({
        team1_matches_won: team1Wins,
        team2_matches_won: team2Wins,
        has_super_tiebreak: needsTiebreak,
        winner_super_team_id: winnerId,
        status: status
      }).eq('id', confrontation.id);

      // Avançar vencedor para o próximo jogo do quadro (se existir)
      if (winnerId && confrontation.next_confrontation_id && (confrontation.next_team_slot === 1 || confrontation.next_team_slot === 2)) {
        const slot = confrontation.next_team_slot;
        const updatePayload = slot === 1
          ? { super_team_1_id: winnerId }
          : { super_team_2_id: winnerId };
        await supabase
          .from('super_team_confrontations')
          .update(updatePayload)
          .eq('id', confrontation.next_confrontation_id);
      }

      onSuccess();
    } catch (err: any) {
      console.error('Error saving results:', err);
      setError(err.message || 'Erro ao guardar resultados');
    } finally {
      setSaving(false);
    }
  };

  const { team1Wins, team2Wins, needsTiebreak } = calculateResults();

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Introduzir Resultados</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Teams */}
        <div className="p-4 bg-gray-50 border-b">
          <div className="flex items-center justify-between text-center">
            <div className="flex-1">
              <p className="font-semibold text-blue-600">{team1?.name ?? 'A definir'}</p>
            </div>
            <div className="px-4 text-gray-400 font-bold text-xl">VS</div>
            <div className="flex-1">
              <p className="font-semibold text-red-600">{team2?.name ?? 'A definir'}</p>
            </div>
          </div>
        </div>

        {/* Results Summary */}
        <div className="p-4 bg-gradient-to-r from-blue-50 to-red-50 border-b">
          <div className="flex items-center justify-center gap-4">
            <span className={`text-3xl font-bold ${team1Wins > team2Wins ? 'text-green-600' : 'text-gray-700'}`}>
              {team1Wins}
            </span>
            <span className="text-gray-400 text-xl">-</span>
            <span className={`text-3xl font-bold ${team2Wins > team1Wins ? 'text-green-600' : 'text-gray-700'}`}>
              {team2Wins}
            </span>
          </div>
          {needsTiebreak && (
            <p className="text-center text-sm text-yellow-600 mt-1">Super Tie-Break necessário!</p>
          )}
        </div>

        {/* Games */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Jogo 1 - Duo 1 */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium text-gray-700 mb-3">Jogo 1 (Dupla 1)</h3>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">{team1?.name ?? 'Equipa 1'}</label>
                <input
                  type="number"
                  min="0"
                  value={duo1Team1Score}
                  onChange={(e) => setDuo1Team1Score(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              </div>
              <span className="text-gray-400 text-xl font-bold">-</span>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">{team2?.name ?? 'Equipa 2'}</label>
                <input
                  type="number"
                  min="0"
                  value={duo1Team2Score}
                  onChange={(e) => setDuo1Team2Score(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Jogo 2 - Duo 2 */}
          <div className="border rounded-lg p-4">
            <h3 className="font-medium text-gray-700 mb-3">Jogo 2 (Dupla 2)</h3>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">{team1?.name ?? 'Equipa 1'}</label>
                <input
                  type="number"
                  min="0"
                  value={duo2Team1Score}
                  onChange={(e) => setDuo2Team1Score(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              </div>
              <span className="text-gray-400 text-xl font-bold">-</span>
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">{team2?.name ?? 'Equipa 2'}</label>
                <input
                  type="number"
                  min="0"
                  value={duo2Team2Score}
                  onChange={(e) => setDuo2Team2Score(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-blue-500"
                  placeholder="0"
                />
              </div>
            </div>
          </div>

          {/* Super Tie-Break (apenas se empate 1-1) */}
          {needsTiebreak && (
            <div className="border-2 border-yellow-300 bg-yellow-50 rounded-lg p-4">
              <h3 className="font-medium text-yellow-700 mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4" />
                Super Tie-Break (até 10 pontos)
              </h3>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">{team1?.name ?? 'Equipa 1'}</label>
                  <input
                    type="number"
                    min="0"
                    value={tiebreakTeam1Score}
                    onChange={(e) => setTiebreakTeam1Score(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-yellow-500"
                    placeholder="0"
                  />
                </div>
                <span className="text-gray-400 text-xl font-bold">-</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">{team2?.name ?? 'Equipa 2'}</label>
                  <input
                    type="number"
                    min="0"
                    value={tiebreakTeam2Score}
                    onChange={(e) => setTiebreakTeam2Score(e.target.value === '' ? '' : Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-center text-lg font-bold focus:ring-2 focus:ring-yellow-500"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'A guardar...' : 'Guardar Resultados'}
          </button>
        </div>
      </div>
    </div>
  );
}
