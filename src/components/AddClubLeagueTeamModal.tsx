import React, { useEffect, useRef, useState } from 'react';
import { X, Save, Crown, Plus, Trash2, Loader2, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Category = { id: string; name: string };

type PlayerAccount = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
};

type PlayerRow = {
  name: string;
  phone: string;
  fpp: string;
  isCaptain: boolean;
  found: boolean;
};

type Props = {
  tournamentId: string;
  categories: Category[];
  selectedCategory: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

const emptyPlayer = (captain = false): PlayerRow => ({
  name: '',
  phone: '',
  fpp: '',
  isCaptain: captain,
  found: false,
});

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  let hadPrefix = false;
  if (cleaned.startsWith('+00')) { cleaned = cleaned.slice(3); hadPrefix = true; }
  else if (cleaned.startsWith('+')) { cleaned = cleaned.slice(1); hadPrefix = true; }
  else if (cleaned.startsWith('00')) { cleaned = cleaned.slice(2); hadPrefix = true; }
  if (hadPrefix) {
    cleaned = cleaned.replace(/^(351|352|353)(?=\d{7,})/, '');
  } else {
    cleaned = cleaned.replace(/^351(?=[29]\d{8}$)/, '');
  }
  if (cleaned.startsWith('0') && cleaned.length >= 9) cleaned = cleaned.slice(1);
  return cleaned;
}

export default function AddClubLeagueTeamModal({
  tournamentId,
  categories,
  selectedCategory,
  onClose,
  onSuccess,
}: Props) {
  const [teamName, setTeamName] = useState('');
  const [categoryId, setCategoryId] = useState(selectedCategory || categories[0]?.id || '');
  const [players, setPlayers] = useState<PlayerRow[]>([
    emptyPlayer(true),
    emptyPlayer(),
    emptyPlayer(),
    emptyPlayer(),
    emptyPlayer(),
    emptyPlayer(),
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [allAccounts, setAllAccounts] = useState<PlayerAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState<Record<number, string>>({});
  const [activeSearch, setActiveSearch] = useState<number | null>(null);
  const searchRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    supabase
      .from('player_accounts')
      .select('id, name, email, phone_number')
      .order('name')
      .then(({ data }) => { if (data) setAllAccounts(data); });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeSearch !== null) {
        const ref = searchRefs.current[activeSearch];
        if (ref && !ref.contains(e.target as Node)) setActiveSearch(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeSearch]);

  const getFilteredAccounts = (index: number) => {
    const query = (searchQuery[index] || '').toLowerCase().trim();
    if (!query) return allAccounts.slice(0, 20);
    return allAccounts.filter(a =>
      a.name.toLowerCase().includes(query) ||
      (a.phone_number && a.phone_number.includes(query))
    ).slice(0, 15);
  };

  const selectAccount = (index: number, account: PlayerAccount) => {
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        name: account.name,
        phone: account.phone_number || '',
        found: true,
      };
      return updated;
    });
    setActiveSearch(null);
    setSearchQuery(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const updatePlayer = (index: number, field: keyof PlayerRow, value: string | boolean) => {
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'isCaptain' && value === true) {
        updated.forEach((p, i) => { if (i !== index) p.isCaptain = false; });
      }
      return updated;
    });
  };

  const addPlayer = () => setPlayers(prev => [...prev, emptyPlayer()]);
  const removePlayer = (index: number) => {
    setPlayers(prev => {
      if (prev.length <= 6) return prev;
      const updated = prev.filter((_, i) => i !== index);
      if (!updated.some(p => p.isCaptain) && updated[0]) updated[0].isCaptain = true;
      return updated;
    });
  };

  const handleSubmit = async () => {
    setError('');
    if (!teamName.trim()) { setError('Introduza o nome do clube/equipa'); return; }
    if (players.length < 6) { setError('O plantel precisa de pelo menos 6 jogadores'); return; }

    for (let i = 0; i < players.length; i++) {
      if (!players[i].name.trim()) { setError(`Nome em falta no jogador ${i + 1}`); return; }
      if (!players[i].phone.trim()) { setError(`Telefone em falta no jogador ${i + 1}`); return; }
      const fpp = Number(players[i].fpp);
      if (players[i].fpp === '' || Number.isNaN(fpp) || fpp < 0) {
        setError(`Pontos FPP inválidos no jogador ${i + 1}`);
        return;
      }
    }
    if (!players.some(p => p.isCaptain)) { setError('Selecione um capitão'); return; }

    const phones = players.map(p => normalizePhone(p.phone));
    if (new Set(phones).size !== phones.length) {
      setError('Cada jogador deve ter um telefone diferente');
      return;
    }

    setLoading(true);
    try {
      const { count } = await supabase
        .from('club_league_teams')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId);

      const { data: team, error: teamError } = await supabase
        .from('club_league_teams')
        .insert({
          tournament_id: tournamentId,
          category_id: categoryId || null,
          name: teamName.trim(),
          registration_order: (count || 0) + 1,
        })
        .select()
        .single();
      if (teamError) throw teamError;

      const inserts = [];
      for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const phone = normalizePhone(p.phone);
        let playerAccountId: string | null = null;
        const { data: existing } = await supabase
          .from('player_accounts')
          .select('id')
          .eq('phone_number', phone)
          .maybeSingle();
        if (existing) playerAccountId = existing.id;

        inserts.push({
          team_id: team.id,
          player_account_id: playerAccountId,
          name: p.name.trim(),
          email: null,
          phone_number: phone,
          fpp_points: Number(p.fpp),
          is_captain: p.isCaptain,
          player_order: i + 1,
        });
      }

      const { data: insertedPlayers, error: playersError } = await supabase
        .from('club_league_players')
        .insert(inserts)
        .select('id, is_captain');
      if (playersError) throw playersError;

      const captain = insertedPlayers?.find(p => p.is_captain);
      if (captain) {
        await supabase
          .from('club_league_teams')
          .update({ captain_player_id: captain.id })
          .eq('id', team.id);
      }

      await supabase.from('club_league_standings').insert({
        tournament_id: tournamentId,
        category_id: categoryId || null,
        team_id: team.id,
      });

      onSuccess();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message: string }).message)
          : err instanceof Error
            ? err.message
            : 'Erro ao guardar equipa';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white">
          <h2 className="text-lg font-semibold">Inscrever clube — Liga de Clubes</h2>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Nome do clube</label>
              <input
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Ex: Padel Club Norte"
              />
            </div>
            {categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-1">Categoria</label>
                <select
                  value={categoryId}
                  onChange={e => setCategoryId(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Plantel (mín. 6) — telefone + FPP</h3>
              <button
                type="button"
                onClick={addPlayer}
                className="text-sm flex items-center gap-1 text-emerald-700 hover:underline"
              >
                <Plus className="w-4 h-4" /> Jogador
              </button>
            </div>

            <div className="space-y-3">
              {players.map((p, index) => (
                <div key={index} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Jogador {index + 1}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updatePlayer(index, 'isCaptain', true)}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded ${
                          p.isCaptain ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        <Crown className="w-3 h-3" /> Capitão
                      </button>
                      {players.length > 6 && (
                        <button type="button" onClick={() => removePlayer(index)} className="text-red-500 p-1">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative" ref={el => { searchRefs.current[index] = el; }}>
                    <div className="flex items-center gap-1 border rounded-lg px-2">
                      <Search className="w-4 h-4 text-gray-400" />
                      <input
                        value={activeSearch === index ? (searchQuery[index] ?? p.name) : p.name}
                        onFocus={() => {
                          setActiveSearch(index);
                          setSearchQuery(prev => ({ ...prev, [index]: prev[index] ?? p.name }));
                        }}
                        onChange={e => {
                          setSearchQuery(prev => ({ ...prev, [index]: e.target.value }));
                          updatePlayer(index, 'name', e.target.value);
                          setActiveSearch(index);
                        }}
                        placeholder="Pesquisar ou escrever nome"
                        className="flex-1 py-2 outline-none text-sm"
                      />
                    </div>
                    {activeSearch === index && (
                      <div className="absolute z-10 mt-1 w-full bg-white border rounded-lg shadow max-h-40 overflow-y-auto">
                        {getFilteredAccounts(index).map(a => (
                          <button
                            key={a.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                            onClick={() => selectAccount(index, a)}
                          >
                            {a.name} {a.phone_number ? `· ${a.phone_number}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={p.phone}
                      onChange={e => updatePlayer(index, 'phone', e.target.value)}
                      placeholder="Telefone *"
                      className="border rounded-lg px-3 py-2 text-sm"
                    />
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={p.fpp}
                      onChange={e => updatePlayer(index, 'fpp', e.target.value)}
                      placeholder="Pontos FPP *"
                      className="border rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border">
            Cancelar
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={handleSubmit}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
