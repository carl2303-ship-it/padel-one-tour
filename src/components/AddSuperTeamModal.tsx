import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Crown, Phone, User, Mail, Loader2, CheckCircle, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Category = {
  id: string;
  name: string;
};

type PlayerAccount = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
};

type PlayerData = {
  name: string;
  email: string;
  phone: string;
  isCaptain: boolean;
  found: boolean;
  loading: boolean;
};

type Props = {
  tournamentId: string;
  categories: Category[];
  selectedCategory: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AddSuperTeamModal({ tournamentId, categories, selectedCategory, onClose, onSuccess }: Props) {
  const [teamName, setTeamName] = useState('');
  const [categoryId, setCategoryId] = useState(selectedCategory || '');
  const [players, setPlayers] = useState<PlayerData[]>([
    { name: '', email: '', phone: '', isCaptain: true, found: false, loading: false },
    { name: '', email: '', phone: '', isCaptain: false, found: false, loading: false },
    { name: '', email: '', phone: '', isCaptain: false, found: false, loading: false },
    { name: '', email: '', phone: '', isCaptain: false, found: false, loading: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [allAccounts, setAllAccounts] = useState<PlayerAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState<Record<number, string>>({});
  const [activeSearch, setActiveSearch] = useState<number | null>(null);
  const searchRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const fetchAccounts = async () => {
      const { data } = await supabase
        .from('player_accounts')
        .select('id, name, email, phone_number')
        .order('name');
      if (data) setAllAccounts(data);
    };
    fetchAccounts();
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (activeSearch !== null) {
        const ref = searchRefs.current[activeSearch];
        if (ref && !ref.contains(e.target as Node)) {
          setActiveSearch(null);
        }
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeSearch]);

  const normalizePhone = (phone: string): string => {
    let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
    if (cleaned.startsWith('+351')) return cleaned;
    if (cleaned.startsWith('351') && cleaned.length >= 12) return '+' + cleaned;
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('0')) cleaned = cleaned.substring(1);
    if (cleaned.length === 9) return '+351' + cleaned;
    return '+351' + cleaned;
  };

  const getFilteredAccounts = (index: number) => {
    const query = (searchQuery[index] || '').toLowerCase().trim();
    if (!query) return allAccounts.slice(0, 20);
    return allAccounts.filter(a =>
      a.name.toLowerCase().includes(query) ||
      (a.phone_number && a.phone_number.includes(query)) ||
      (a.email && a.email.toLowerCase().includes(query))
    ).slice(0, 15);
  };

  const selectAccount = (index: number, account: PlayerAccount) => {
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        name: account.name,
        email: account.email || '',
        phone: account.phone_number || '',
        found: true,
      };
      return updated;
    });
    setActiveSearch(null);
    setSearchQuery(prev => ({ ...prev, [index]: '' }));
  };

  const clearPlayer = (index: number) => {
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], name: '', email: '', phone: '', found: false };
      return updated;
    });
  };

  const lookupPlayerByPhone = async (index: number, phone: string) => {
    if (!phone || phone.length < 9) return;
    const normalizedPhone = normalizePhone(phone);

    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], loading: true };
      return updated;
    });

    try {
      const { data: account } = await supabase
        .from('player_accounts')
        .select('name, email, phone_number')
        .eq('phone_number', normalizedPhone)
        .maybeSingle();

      setPlayers(prev => {
        const updated = [...prev];
        if (account) {
          updated[index] = { ...updated[index], name: account.name || '', email: account.email || '', phone: normalizedPhone, found: true, loading: false };
        } else {
          updated[index] = { ...updated[index], phone: normalizedPhone, found: false, loading: false };
        }
        return updated;
      });
    } catch {
      setPlayers(prev => {
        const updated = [...prev];
        updated[index] = { ...updated[index], loading: false };
        return updated;
      });
    }
  };

  const updatePlayer = (index: number, field: keyof PlayerData, value: string | boolean) => {
    setPlayers(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      if (field === 'isCaptain' && value === true) {
        updated.forEach((p, i) => { if (i !== index) p.isCaptain = false; });
      }
      if (field === 'phone') {
        updated[index].found = false;
      }
      return updated;
    });
  };

  const handleSubmit = async () => {
    setError('');

    if (!teamName.trim()) { setError('Introduza o nome da equipa'); return; }

    for (let i = 0; i < 4; i++) {
      if (!players[i].name.trim()) { setError(`Introduza o nome do Jogador ${i + 1}`); return; }
      if (!players[i].phone.trim()) { setError(`Introduza o telefone do Jogador ${i + 1}`); return; }
    }

    if (!players.some(p => p.isCaptain)) { setError('Selecione um capitão'); return; }

    const phones = players.map(p => normalizePhone(p.phone));
    if (new Set(phones).size !== 4) { setError('Cada jogador deve ter um telefone diferente'); return; }

    setLoading(true);

    try {
      const { count } = await supabase
        .from('super_teams')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId);

      const { data: superTeam, error: teamError } = await supabase
        .from('super_teams')
        .insert({
          tournament_id: tournamentId,
          category_id: categoryId || null,
          name: teamName.trim(),
          registration_order: (count || 0) + 1,
        })
        .select()
        .single();

      if (teamError) throw teamError;

      const playerInserts = [];
      for (let i = 0; i < 4; i++) {
        const player = players[i];
        const normalizedPhone = normalizePhone(player.phone);

        let playerAccountId = null;
        const { data: existing } = await supabase
          .from('player_accounts')
          .select('id')
          .eq('phone_number', normalizedPhone)
          .maybeSingle();

        if (existing) {
          playerAccountId = existing.id;
        }

        playerInserts.push({
          super_team_id: superTeam.id,
          player_account_id: playerAccountId,
          name: player.name.trim(),
          email: player.email.trim() || null,
          phone_number: normalizedPhone,
          is_captain: player.isCaptain,
          player_order: i + 1,
        });
      }

      const { error: playersError } = await supabase
        .from('super_team_players')
        .insert(playerInserts);

      if (playersError) throw playersError;

      onSuccess();
    } catch (err: any) {
      console.error('Error creating super team:', err);
      setError(err.message || 'Erro ao criar equipa');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b bg-green-600 text-white">
          <h2 className="text-xl font-semibold">Adicionar Super Equipa</h2>
          <button onClick={onClose} className="p-1 hover:bg-green-700 rounded-lg transition">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-130px)] space-y-6">
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome da Equipa *</label>
              <input
                type="text"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                placeholder="Ex: Os Invencíveis"
              />
            </div>

            {categories.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                >
                  <option value="">Sem categoria</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold text-gray-900">Jogadores (4 obrigatórios)</h3>

            {players.map((player, index) => (
              <div
                key={index}
                className={`border rounded-lg p-4 ${player.isCaptain ? 'border-yellow-400 bg-yellow-50' : 'border-gray-200'}`}
              >
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-gray-900">
                    Jogador {index + 1}
                    {player.isCaptain && (
                      <span className="ml-2 text-yellow-600 text-sm">
                        <Crown className="w-4 h-4 inline" /> Capitão
                      </span>
                    )}
                  </h4>
                  <div className="flex items-center gap-3">
                    {player.found && (
                      <button
                        onClick={() => clearPlayer(index)}
                        className="text-xs text-red-500 hover:text-red-700 underline"
                      >
                        Limpar
                      </button>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="captain"
                        checked={player.isCaptain}
                        onChange={() => updatePlayer(index, 'isCaptain', true)}
                        className="text-yellow-500 focus:ring-yellow-500"
                      />
                      <span className="text-sm text-gray-600">Capitão</span>
                    </label>
                  </div>
                </div>

                {/* Player search */}
                <div className="relative mb-3" ref={(el) => { searchRefs.current[index] = el; }}>
                  <div className="relative">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={activeSearch === index ? (searchQuery[index] || '') : (player.found ? player.name : '')}
                      onChange={(e) => {
                        setSearchQuery(prev => ({ ...prev, [index]: e.target.value }));
                        setActiveSearch(index);
                      }}
                      onFocus={() => setActiveSearch(index)}
                      className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm"
                      placeholder="Pesquisar jogador por nome, telefone ou email..."
                      disabled={player.found}
                    />
                    {player.found && (
                      <CheckCircle className="absolute right-3 top-2.5 w-4 h-4 text-green-600" />
                    )}
                  </div>

                  {activeSearch === index && !player.found && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {getFilteredAccounts(index).length === 0 ? (
                        <div className="p-3 text-sm text-gray-500 text-center">Nenhum jogador encontrado</div>
                      ) : (
                        getFilteredAccounts(index).map(account => (
                          <button
                            key={account.id}
                            onClick={() => selectAccount(index, account)}
                            className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-gray-50 last:border-0 flex items-center gap-3"
                          >
                            <div className="w-8 h-8 rounded-full bg-green-100 text-green-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {account.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{account.name}</p>
                              <p className="text-xs text-gray-500 truncate">
                                {account.phone_number}{account.email ? ` · ${account.email}` : ''}
                              </p>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {player.found ? (
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="text-xs text-gray-500 block">Nome</span>
                      <span className="font-medium">{player.name}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Telefone</span>
                      <span className="font-medium">{player.phone}</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-500 block">Email</span>
                      <span className="font-medium text-gray-600">{player.email || '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        <Phone className="w-3 h-3 inline mr-1" />Telefone *
                      </label>
                      <div className="relative">
                        <input
                          type="tel"
                          value={player.phone}
                          onChange={(e) => updatePlayer(index, 'phone', e.target.value)}
                          onBlur={(e) => lookupPlayerByPhone(index, e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                          placeholder="+351 912 345 678"
                        />
                        {player.loading && <Loader2 className="absolute right-3 top-2.5 w-4 h-4 animate-spin text-gray-400" />}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        <User className="w-3 h-3 inline mr-1" />Nome *
                      </label>
                      <input
                        type="text"
                        value={player.name}
                        onChange={(e) => updatePlayer(index, 'name', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="Nome completo"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        <Mail className="w-3 h-3 inline mr-1" />Email
                      </label>
                      <input
                        type="email"
                        value={player.email}
                        onChange={(e) => updatePlayer(index, 'email', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                        placeholder="email@exemplo.com"
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {loading ? 'A criar...' : 'Criar Super Equipa'}
          </button>
        </div>
      </div>
    </div>
  );
}
