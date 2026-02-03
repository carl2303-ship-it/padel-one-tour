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
