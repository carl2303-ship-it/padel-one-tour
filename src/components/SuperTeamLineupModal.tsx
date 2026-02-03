import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { X, Shuffle, Users } from 'lucide-react';

type SuperTeamPlayer = {
  id: string;
  name: string;
  is_captain: boolean;
  player_order: number;
};

type SuperTeam = {
  id: string;
  name: string;
  super_team_players: SuperTeamPlayer[];
};

type Confrontation = {
  id: string;
  super_team_1_id: string | null;
  super_team_2_id: string | null;
};

type Lineup = {
  id: string;
  confrontation_id: string;
  super_team_id: string;
  duo1_player1_id: string | null;
  duo1_player2_id: string | null;
  duo2_player1_id: string | null;
  duo2_player2_id: string | null;
  super_tiebreak_player1_id: string | null;
  super_tiebreak_player2_id: string | null;
};

type Props = {
  confrontation: Confrontation;
  team: SuperTeam;
  onClose: () => void;
  onSuccess: () => void;
};

export default function SuperTeamLineupModal({ confrontation, team, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lineupId, setLineupId] = useState<string | null>(null);
  const [duo1Player1, setDuo1Player1] = useState<string>('');
  const [duo1Player2, setDuo1Player2] = useState<string>('');
  const [duo2Player1, setDuo2Player1] = useState<string>('');
  const [duo2Player2, setDuo2Player2] = useState<string>('');
  const [tie1, setTie1] = useState<string>('');
  const [tie2, setTie2] = useState<string>('');

  const players = useMemo(
    () => (team.super_team_players || []).slice().sort((a, b) => a.player_order - b.player_order),
    [team.super_team_players]
  );

  useEffect(() => {
    const fetchLineup = async () => {
      setLoading(true);
      const { data } = await supabase
        .from('super_team_lineups')
        .select('*')
        .eq('confrontation_id', confrontation.id)
        .eq('super_team_id', team.id)
        .maybeSingle();
      if (data) {
        setLineupId(data.id);
        setDuo1Player1(data.duo1_player1_id || '');
        setDuo1Player2(data.duo1_player2_id || '');
        setDuo2Player1(data.duo2_player1_id || '');
        setDuo2Player2(data.duo2_player2_id || '');
        setTie1(data.super_tiebreak_player1_id || '');
        setTie2(data.super_tiebreak_player2_id || '');
      }
      setLoading(false);
    };
    fetchLineup();
  }, [confrontation.id, team.id]);

  const randomizeLineup = () => {
    if (players.length < 4) return;
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    const [p1, p2, p3, p4] = shuffled;
    setDuo1Player1(p1.id);
    setDuo1Player2(p2.id);
    setDuo2Player1(p3.id);
    setDuo2Player2(p4.id);
    setTie1(p1.id);
    setTie2(p3.id);
  };

  const validate = () => {
    const chosen = [duo1Player1, duo1Player2, duo2Player1, duo2Player2];
    if (chosen.some((v) => !v)) {
      setError('Selecione todos os jogadores das duplas.');
      return false;
    }
    const unique = new Set(chosen);
    if (unique.size !== 4) {
      setError('Cada jogador deve ser único nas duplas.');
      return false;
    }
    if ((tie1 && !tie2) || (!tie1 && tie2)) {
      setError('Selecione ambos os jogadores do super tie-break ou nenhum.');
      return false;
    }
    setError('');
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    const payload: Omit<Lineup, 'id'> = {
      confrontation_id: confrontation.id,
      super_team_id: team.id,
      duo1_player1_id: duo1Player1,
      duo1_player2_id: duo1Player2,
      duo2_player1_id: duo2Player1,
      duo2_player2_id: duo2Player2,
      super_tiebreak_player1_id: tie1 || null,
      super_tiebreak_player2_id: tie2 || null,
    };
    const { error: saveError } = lineupId
      ? await supabase.from('super_team_lineups').update(payload).eq('id', lineupId)
      : await supabase.from('super_team_lineups').insert(payload);
    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSuccess();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl p-6 w-full max-w-lg">A carregar...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Definir Duplas</h2>
            <p className="text-sm text-gray-500">{team.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <button
            type="button"
            onClick={randomizeLineup}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <Shuffle className="w-4 h-4" />
            Sortear Duplas Aleatoriamente
          </button>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-700 font-semibold mb-3">
              <Users className="w-4 h-4" />
              Dupla 1 (Jogo 1)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={duo1Player1} onChange={(e) => setDuo1Player1(e.target.value)} className="px-3 py-2 border rounded">
                <option value="">Selecionar...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={duo1Player2} onChange={(e) => setDuo1Player2(e.target.value)} className="px-3 py-2 border rounded">
                <option value="">Selecionar...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-green-50 border border-green-100 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-700 font-semibold mb-3">
              <Users className="w-4 h-4" />
              Dupla 2 (Jogo 2)
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={duo2Player1} onChange={(e) => setDuo2Player1(e.target.value)} className="px-3 py-2 border rounded">
                <option value="">Selecionar...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={duo2Player2} onChange={(e) => setDuo2Player2(e.target.value)} className="px-3 py-2 border rounded">
                <option value="">Selecionar...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
            <div className="text-amber-800 font-semibold mb-3">Super Tie-Break (em caso de empate)</div>
            <div className="grid grid-cols-2 gap-3">
              <select value={tie1} onChange={(e) => setTie1(e.target.value)} className="px-3 py-2 border rounded">
                <option value="">Selecionar...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select value={tie2} onChange={(e) => setTie2(e.target.value)} className="px-3 py-2 border rounded">
                <option value="">Selecionar...</option>
                {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <p className="text-xs text-amber-700 mt-2">Seleciona 1 jogador de cada dupla.</p>
          </div>

          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>

        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Guardar Lineup
          </button>
        </div>
      </div>
    </div>
  );
}
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X, Users, Save, AlertCircle, CheckCircle, Shuffle, Crown } from 'lucide-react';

interface SuperTeamPlayer {
  id: string;
  name: string;
  is_captain: boolean;
  player_order: number;
}

interface SuperTeam {
  id: string;
  name: string;
  super_team_players?: SuperTeamPlayer[];
}

interface Confrontation {
  id: string;
  super_team_1_id: string;
  super_team_2_id: string;
  scheduled_time: string;
  court_name: string;
  status: string;
}

interface SuperTeamLineupModalProps {
  confrontation: Confrontation;
  superTeam: SuperTeam;
  onClose: () => void;
  onSuccess: () => void;
}

export default function SuperTeamLineupModal({
  confrontation,
  superTeam,
  onClose,
  onSuccess,
}: SuperTeamLineupModalProps) {
  const [players, setPlayers] = useState<SuperTeamPlayer[]>([]);
  const [duo1, setDuo1] = useState<{ player1: string | null; player2: string | null }>({
    player1: null,
    player2: null,
  });
  const [duo2, setDuo2] = useState<{ player1: string | null; player2: string | null }>({
    player1: null,
    player2: null,
  });
  const [superTiebreakPlayers, setSuperTiebreakPlayers] = useState<{
    fromDuo1: string | null;
    fromDuo2: string | null;
  }>({
    fromDuo1: null,
    fromDuo2: null,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [existingLineup, setExistingLineup] = useState<any>(null);

  useEffect(() => {
    fetchPlayers();
    fetchExistingLineup();
  }, [superTeam.id, confrontation.id]);

  const fetchPlayers = async () => {
    const { data } = await supabase
      .from('super_team_players')
      .select('id, name, is_captain, player_order')
      .eq('super_team_id', superTeam.id)
      .order('player_order');

    if (data) {
      setPlayers(data);
    }
  };

  const fetchExistingLineup = async () => {
    const { data } = await supabase
      .from('super_team_lineups')
      .select('*')
      .eq('confrontation_id', confrontation.id)
      .eq('super_team_id', superTeam.id)
      .maybeSingle();

    if (data) {
      setExistingLineup(data);
      setDuo1({
        player1: data.duo1_player1_id,
        player2: data.duo1_player2_id,
      });
      setDuo2({
        player1: data.duo2_player1_id,
        player2: data.duo2_player2_id,
      });
      setSuperTiebreakPlayers({
        fromDuo1: data.super_tiebreak_player1_id,
        fromDuo2: data.super_tiebreak_player2_id,
      });
    }
  };

  const getAvailablePlayers = (excludeIds: (string | null)[]): SuperTeamPlayer[] => {
    return players.filter((p) => !excludeIds.includes(p.id));
  };

  const isComplete = (): boolean => {
    return (
      duo1.player1 !== null &&
      duo1.player2 !== null &&
      duo2.player1 !== null &&
      duo2.player2 !== null
    );
  };

  const randomizeLineup = () => {
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    setDuo1({
      player1: shuffled[0]?.id || null,
      player2: shuffled[1]?.id || null,
    });
    setDuo2({
      player1: shuffled[2]?.id || null,
      player2: shuffled[3]?.id || null,
    });
    // Reset super tiebreak players
    setSuperTiebreakPlayers({
      fromDuo1: null,
      fromDuo2: null,
    });
  };

  const handleSubmit = async () => {
    if (!isComplete()) {
      setError('Por favor selecione todos os jogadores para as duas duplas');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const lineupData = {
        confrontation_id: confrontation.id,
        super_team_id: superTeam.id,
        duo1_player1_id: duo1.player1,
        duo1_player2_id: duo1.player2,
        duo2_player1_id: duo2.player1,
        duo2_player2_id: duo2.player2,
        super_tiebreak_player1_id: superTiebreakPlayers.fromDuo1,
        super_tiebreak_player2_id: superTiebreakPlayers.fromDuo2,
      };

      if (existingLineup) {
        const { error: updateError } = await supabase
          .from('super_team_lineups')
          .update(lineupData)
          .eq('id', existingLineup.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('super_team_lineups')
          .insert(lineupData);

        if (insertError) throw insertError;
      }

      onSuccess();
    } catch (err: any) {
      console.error('Erro ao guardar lineup:', err);
      setError(err.message || 'Erro ao guardar lineup');
    } finally {
      setLoading(false);
    }
  };

  const getPlayerName = (id: string | null): string => {
    if (!id) return 'Selecionar...';
    const player = players.find((p) => p.id === id);
    return player?.name || 'Desconhecido';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Definir Duplas</h2>
            <p className="text-sm text-gray-500">{superTeam.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          {/* Randomize Button */}
          <button
            onClick={randomizeLineup}
            className="w-full py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition flex items-center justify-center gap-2"
          >
            <Shuffle className="w-4 h-4" />
            Sortear Duplas Aleatoriamente
          </button>

          {/* Dupla 1 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Dupla 1 (Jogo 1)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-blue-700 mb-1">
                  Jogador 1
                </label>
                <select
                  value={duo1.player1 || ''}
                  onChange={(e) => setDuo1({ ...duo1, player1: e.target.value || null })}
                  className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="">Selecionar...</option>
                  {getAvailablePlayers([duo1.player2, duo2.player1, duo2.player2]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_captain && '👑'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-blue-700 mb-1">
                  Jogador 2
                </label>
                <select
                  value={duo1.player2 || ''}
                  onChange={(e) => setDuo1({ ...duo1, player2: e.target.value || null })}
                  className="w-full px-3 py-2 border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                >
                  <option value="">Selecionar...</option>
                  {getAvailablePlayers([duo1.player1, duo2.player1, duo2.player2]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_captain && '👑'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Dupla 2 */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Dupla 2 (Jogo 2)
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-green-700 mb-1">
                  Jogador 1
                </label>
                <select
                  value={duo2.player1 || ''}
                  onChange={(e) => setDuo2({ ...duo2, player1: e.target.value || null })}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                >
                  <option value="">Selecionar...</option>
                  {getAvailablePlayers([duo1.player1, duo1.player2, duo2.player2]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_captain && '👑'}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-green-700 mb-1">
                  Jogador 2
                </label>
                <select
                  value={duo2.player2 || ''}
                  onChange={(e) => setDuo2({ ...duo2, player2: e.target.value || null })}
                  className="w-full px-3 py-2 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                >
                  <option value="">Selecionar...</option>
                  {getAvailablePlayers([duo1.player1, duo1.player2, duo2.player1]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.is_captain && '👑'}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Super Tie-Break (opcional) */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-semibold text-yellow-900 mb-2 flex items-center gap-2">
              <Crown className="w-5 h-5" />
              Super Tie-Break (em caso de empate)
            </h3>
            <p className="text-xs text-yellow-700 mb-3">
              Selecione 1 jogador de cada dupla para o super tie-break (pode definir mais tarde)
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-yellow-700 mb-1">
                  Da Dupla 1
                </label>
                <select
                  value={superTiebreakPlayers.fromDuo1 || ''}
                  onChange={(e) =>
                    setSuperTiebreakPlayers({
                      ...superTiebreakPlayers,
                      fromDuo1: e.target.value || null,
                    })
                  }
                  className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent bg-white"
                  disabled={!duo1.player1 && !duo1.player2}
                >
                  <option value="">Selecionar...</option>
                  {duo1.player1 && (
                    <option value={duo1.player1}>{getPlayerName(duo1.player1)}</option>
                  )}
                  {duo1.player2 && (
                    <option value={duo1.player2}>{getPlayerName(duo1.player2)}</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-yellow-700 mb-1">
                  Da Dupla 2
                </label>
                <select
                  value={superTiebreakPlayers.fromDuo2 || ''}
                  onChange={(e) =>
                    setSuperTiebreakPlayers({
                      ...superTiebreakPlayers,
                      fromDuo2: e.target.value || null,
                    })
                  }
                  className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 focus:border-transparent bg-white"
                  disabled={!duo2.player1 && !duo2.player2}
                >
                  <option value="">Selecionar...</option>
                  {duo2.player1 && (
                    <option value={duo2.player1}>{getPlayerName(duo2.player1)}</option>
                  )}
                  {duo2.player2 && (
                    <option value={duo2.player2}>{getPlayerName(duo2.player2)}</option>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Preview */}
          {isComplete() && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h4 className="font-semibold text-gray-900 mb-2">Resumo</h4>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-blue-600 font-medium">Jogo 1:</span>{' '}
                  {getPlayerName(duo1.player1)} / {getPlayerName(duo1.player2)}
                </p>
                <p>
                  <span className="text-green-600 font-medium">Jogo 2:</span>{' '}
                  {getPlayerName(duo2.player1)} / {getPlayerName(duo2.player2)}
                </p>
                {superTiebreakPlayers.fromDuo1 && superTiebreakPlayers.fromDuo2 && (
                  <p>
                    <span className="text-yellow-600 font-medium">Super TB:</span>{' '}
                    {getPlayerName(superTiebreakPlayers.fromDuo1)} /{' '}
                    {getPlayerName(superTiebreakPlayers.fromDuo2)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !isComplete()}
            className="flex-1 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2"
          >
            {loading ? (
              'A guardar...'
            ) : (
              <>
                <Save className="w-4 h-4" />
                Guardar Lineup
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
