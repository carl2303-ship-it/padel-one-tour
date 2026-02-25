import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import {
  X,
  Download,
  Search,
  Users,
  Mail,
  Phone,
  Trophy,
  Filter,
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Tag,
  Calendar,
  Gauge,
  Edit3,
  Check,
} from 'lucide-react';

const PLAYER_CATEGORIES = [
  { value: 'M6', label: 'M6', gender: 'M' },
  { value: 'M5', label: 'M5', gender: 'M' },
  { value: 'M4', label: 'M4', gender: 'M' },
  { value: 'M3', label: 'M3', gender: 'M' },
  { value: 'M2', label: 'M2', gender: 'M' },
  { value: 'M1', label: 'M1', gender: 'M' },
  { value: 'F6', label: 'F6', gender: 'F' },
  { value: 'F5', label: 'F5', gender: 'F' },
  { value: 'F4', label: 'F4', gender: 'F' },
  { value: 'F3', label: 'F3', gender: 'F' },
  { value: 'F2', label: 'F2', gender: 'F' },
  { value: 'F1', label: 'F1', gender: 'F' },
] as const;

type PlayerCategory = typeof PLAYER_CATEGORIES[number]['value'] | null;

interface PlayerRecord {
  id: string;
  normalizedName: string;
  displayName: string;
  email: string | null;
  phone_number: string | null;
  player_category: PlayerCategory;
  level: number | null;
  level_reliability_percent: number | null;
  player_account_id: string | null;
  tournaments: { id: string; name: string; date: string }[];
  organizerPlayerId: string | null;
}

interface OrganizerPlayer {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  player_category: PlayerCategory;
}

interface OrganizerPlayersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizePhoneForRPC(phone: string | null): string | null {
  if (!phone) return null;
  
  // Remove espaços e caracteres especiais
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  
  // Se já começa com +351, retorna como está
  if (cleaned.startsWith('+351')) {
    return cleaned;
  }
  
  // Se começa com 351 (sem +), adiciona o +
  if (cleaned.startsWith('351')) {
    return '+' + cleaned;
  }
  
  // Se começa com +9 mas não tem +351, assume que é português e adiciona +351
  // Exemplo: +961077447 -> +351961077447
  if (cleaned.startsWith('+9') && cleaned.length === 10) {
    return '+351' + cleaned.substring(1);
  }
  
  // Se começa com + mas não é +351 e não é +9, pode ser outro país - retorna como está
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  
  // Se começa com 0, remove o 0 e adiciona +351
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  // Se tem 9 dígitos e começa com 9, assume que é português e adiciona +351
  if (cleaned.length === 9 && cleaned.startsWith('9')) {
    return '+351' + cleaned;
  }
  
  // Se tem 9 dígitos mas não começa com 9, também pode ser português (fixo)
  if (cleaned.length === 9) {
    return '+351' + cleaned;
  }
  
  // Se tem 11 dígitos e começa com 351, adiciona o +
  if (cleaned.length === 11 && cleaned.startsWith('351')) {
    return '+' + cleaned;
  }
  
  // Caso contrário, retorna como está (pode ser formato internacional diferente)
  return cleaned;
}

export default function OrganizerPlayersModal({ isOpen, onClose }: OrganizerPlayersModalProps) {
  const { user } = useAuth();
  const [players, setPlayers] = useState<PlayerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTournament, setSelectedTournament] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [tournaments, setTournaments] = useState<{ id: string; name: string; date: string }[]>([]);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [savingCategory, setSavingCategory] = useState<string | null>(null);
  const [editingLevel, setEditingLevel] = useState<string | null>(null);
  const [editLevelValue, setEditLevelValue] = useState<string>('');
  const [editReliabilityValue, setEditReliabilityValue] = useState<string>('');
  const [savingLevel, setSavingLevel] = useState<string | null>(null);

  const fetchAllPlayers = useCallback(async () => {
    if (!user) return;

    setLoading(true);

    const { data: userTournaments } = await supabase
      .from('tournaments')
      .select('id, name, start_date')
      .eq('user_id', user.id)
      .order('start_date', { ascending: false });

    if (!userTournaments || userTournaments.length === 0) {
      setPlayers([]);
      setTournaments([]);
      setLoading(false);
      return;
    }

    setTournaments(userTournaments.map(t => ({ id: t.id, name: t.name, date: t.start_date })));
    const tournamentIds = userTournaments.map(t => t.id);

    const [playersResult, teamsResult, organizerPlayersResult, playerAccountsResult] = await Promise.all([
      supabase
        .from('players')
        .select('id, name, email, phone_number, tournament_id, player_account_id')
        .in('tournament_id', tournamentIds)
        .order('name'),
      supabase
        .from('teams')
        .select(`
          id,
          tournament_id,
          player1:players!teams_player1_id_fkey(id, name, email, phone_number, player_account_id),
          player2:players!teams_player2_id_fkey(id, name, email, phone_number, player_account_id)
        `)
        .in('tournament_id', tournamentIds),
      supabase
        .from('organizer_players')
        .select('id, name, email, phone_number, player_category')
        .eq('organizer_id', user.id),
      // Fetch ALL player_accounts to get level and reliability data
      supabase
        .from('player_accounts')
        .select('id, name, phone_number, player_category, level, level_reliability_percent'),
    ]);

    const playersData = playersResult.data;
    const teamsData = teamsResult.data;
    const organizerPlayersData = organizerPlayersResult.data || [];
    const playerAccountsData = playerAccountsResult.data || [];

    // Build player_accounts lookup maps (by phone and by name)
    const accountsByPhone = new Map<string, any>();
    const accountsByName = new Map<string, any>();
    playerAccountsData.forEach((pa: any) => {
      if (pa.phone_number) {
        accountsByPhone.set(pa.phone_number.replace(/\s+/g, '').toLowerCase(), pa);
      }
      if (pa.name) {
        accountsByName.set(normalizeName(pa.name), pa);
      }
    });

    const findPlayerAccount = (phone: string | null, name: string): any => {
      if (phone) {
        const normalized = phone.replace(/\s+/g, '').toLowerCase();
        const match = accountsByPhone.get(normalized);
        if (match) return match;
      }
      return accountsByName.get(normalizeName(name)) || null;
    };

    const organizerPlayersMap = new Map<string, OrganizerPlayer>();
    organizerPlayersData.forEach(op => {
      organizerPlayersMap.set(normalizeName(op.name), op as OrganizerPlayer);
    });

    const playerMap = new Map<string, PlayerRecord>();

    const addPlayerToMap = (
      name: string,
      email: string | null,
      phone: string | null,
      tournamentId: string,
      playerAccountId?: string | null
    ) => {
      const tournament = userTournaments.find(t => t.id === tournamentId);
      if (!tournament || !name) return;

      const normalizedName = normalizeName(name);
      const organizerPlayer = organizerPlayersMap.get(normalizedName);
      const playerAccount = playerAccountId 
        ? playerAccountsData.find((pa: any) => pa.id === playerAccountId)
        : findPlayerAccount(phone || organizerPlayer?.phone_number || null, name);

      const existing = playerMap.get(normalizedName);
      if (existing) {
        if (!existing.tournaments.find(t => t.id === tournamentId)) {
          existing.tournaments.push({ id: tournament.id, name: tournament.name, date: tournament.start_date });
          existing.tournaments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }
        if (!existing.email && email) existing.email = email;
        if (!existing.phone_number && phone) existing.phone_number = phone;
        // Update level/reliability from player_account if we didn't have it
        if (playerAccount && !existing.player_account_id) {
          existing.player_account_id = playerAccount.id;
          existing.level = playerAccount.level;
          existing.level_reliability_percent = playerAccount.level_reliability_percent;
        }
      } else {
        playerMap.set(normalizedName, {
          id: normalizedName,
          normalizedName,
          displayName: playerAccount?.name || name.trim(),
          email: organizerPlayer?.email || email,
          phone_number: organizerPlayer?.phone_number || phone,
          player_category: playerAccount?.player_category || organizerPlayer?.player_category || null,
          level: playerAccount?.level || null,
          level_reliability_percent: playerAccount?.level_reliability_percent || null,
          player_account_id: playerAccount?.id || null,
          tournaments: [{ id: tournament.id, name: tournament.name, date: tournament.start_date }],
          organizerPlayerId: organizerPlayer?.id || null,
        });
      }
    };

    playersData?.forEach(p => {
      addPlayerToMap(p.name, p.email, p.phone_number, p.tournament_id, (p as any).player_account_id);
    });

    teamsData?.forEach((team: any) => {
      if (team.player1) {
        addPlayerToMap(
          team.player1.name,
          team.player1.email,
          team.player1.phone_number,
          team.tournament_id,
          team.player1.player_account_id
        );
      }
      if (team.player2) {
        addPlayerToMap(
          team.player2.name,
          team.player2.email,
          team.player2.phone_number,
          team.tournament_id,
          team.player2.player_account_id
        );
      }
    });

    const uniquePlayers = Array.from(playerMap.values());
    uniquePlayers.sort((a, b) => a.displayName.localeCompare(b.displayName));

    setPlayers(uniquePlayers);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (isOpen && user) {
      fetchAllPlayers();
    }
  }, [isOpen, user, fetchAllPlayers]);

  const updatePlayerCategory = async (player: PlayerRecord, category: PlayerCategory) => {
    if (!user) return;

    setSavingCategory(player.id);

    try {
      // 1. Update organizer_players (local contact list)
      if (player.organizerPlayerId) {
        await supabase
          .from('organizer_players')
          .update({
            player_category: category,
            updated_at: new Date().toISOString(),
          })
          .eq('id', player.organizerPlayerId);
      } else {
        const { data } = await supabase
          .from('organizer_players')
          .insert({
            organizer_id: user.id,
            name: player.displayName,
            email: player.email,
            phone_number: player.phone_number,
            player_category: category,
          })
          .select()
          .single();

        if (data) {
          setPlayers(prev =>
            prev.map(p =>
              p.id === player.id
                ? { ...p, organizerPlayerId: data.id, player_category: category }
                : p
            )
          );
        }
      }

      // 2. Update player_accounts (global profile) via RPC
      // This propagates to ALL players records and league_standings
      if (player.phone_number) {
        const normalizedPhone = normalizePhoneForRPC(player.phone_number);
        if (!normalizedPhone) {
          console.warn('Could not normalize phone number:', player.phone_number);
          if (player.playerAccountId) {
            await supabase
              .from('player_accounts')
              .update({
                player_category: category,
                updated_at: new Date().toISOString(),
              })
              .eq('id', player.playerAccountId);
          }
          setSavingCategory(null);
          return;
        }
        
        const { data: rpcResult, error: rpcError } = await supabase.rpc('update_player_account_level', {
          p_phone_number: normalizedPhone,
          p_player_category: category,
        });

        if (rpcError) {
          console.error('RPC update_player_account_level error:', rpcError);
          // Fallback: try direct update to player_accounts
          if (player.playerAccountId) {
            await supabase
              .from('player_accounts')
              .update({
                player_category: category,
                updated_at: new Date().toISOString(),
              })
              .eq('id', player.playerAccountId);
          }
        } else if (rpcResult && !rpcResult.success) {
          console.warn('RPC update_player_account_level: player not found', rpcResult);
        }
      } else if (player.playerAccountId) {
        // No phone number but has playerAccountId - direct update
        await supabase
          .from('player_accounts')
          .update({
            player_category: category,
            updated_at: new Date().toISOString(),
          })
          .eq('id', player.playerAccountId);
      }

      setPlayers(prev =>
        prev.map(p =>
          p.id === player.id ? { ...p, player_category: category } : p
        )
      );
    } catch (error) {
      console.error('Error updating category:', error);
      alert('Erro ao atualizar a categoria. Verifique a consola para mais detalhes.');
    }

    setSavingCategory(null);
  };

  const updatePlayerLevel = async (player: PlayerRecord) => {
    if (!player.phone_number && !player.playerAccountId) {
      alert('Este jogador não tem telefone nem conta associada. Não é possível atualizar o nível.');
      return;
    }
    
    setSavingLevel(player.id);

    try {
      const level = editLevelValue ? parseFloat(editLevelValue) : null;
      const reliability = editReliabilityValue ? parseFloat(editReliabilityValue) : null;

      let updated = false;

      // Try RPC first (propagates to players + league_standings)
      if (player.phone_number) {
        const normalizedPhone = normalizePhoneForRPC(player.phone_number);
        if (!normalizedPhone) {
          console.warn('Could not normalize phone number:', player.phone_number);
          // Fall through to direct update if we have playerAccountId
        } else {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('update_player_account_level', {
            p_phone_number: normalizedPhone,
            p_level: level,
            p_level_reliability_percent: reliability,
          });

          if (!rpcError && rpcResult?.success) {
            updated = true;
          } else {
            console.warn('RPC failed, trying direct update:', rpcError || rpcResult);
          }
        }
      }

      // Fallback: direct update to player_accounts
      if (!updated && player.playerAccountId) {
        const { error } = await supabase
          .from('player_accounts')
          .update({
            level: level,
            level_reliability_percent: reliability,
            updated_at: new Date().toISOString(),
          })
          .eq('id', player.playerAccountId);
        
        if (!error) updated = true;
        else console.error('Direct update failed:', error);
      }

      if (updated) {
        setPlayers(prev =>
          prev.map(p =>
            p.id === player.id
              ? { ...p, level: level, level_reliability_percent: reliability }
              : p
          )
        );
        setEditingLevel(null);
      } else {
        alert('Não foi possível atualizar o nível. Verifique a consola.');
      }
    } catch (error) {
      console.error('Error updating level:', error);
      alert('Erro ao atualizar o nível.');
    }

    setSavingLevel(null);
  };

  const filteredPlayers = players.filter(player => {
    const matchesSearch =
      searchQuery === '' ||
      player.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      player.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      player.phone_number?.includes(searchQuery);

    const matchesTournament =
      selectedTournament === 'all' ||
      player.tournaments.some(t => t.id === selectedTournament);

    const matchesCategory =
      selectedCategory === 'all' ||
      (selectedCategory === 'none' && !player.player_category) ||
      player.player_category === selectedCategory;

    return matchesSearch && matchesTournament && matchesCategory;
  });

  const exportToCSV = () => {
    const headers = ['Nome', 'Email', 'Telefone', 'Categoria', 'Torneios'];
    const rows = filteredPlayers.map(player => [
      player.displayName,
      player.email || '',
      player.phone_number || '',
      player.player_category || '',
      player.tournaments.map(t => t.name).join('; '),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `jogadores_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const copyEmails = () => {
    const emails = filteredPlayers
      .filter(p => p.email)
      .map(p => p.email)
      .join(', ');
    navigator.clipboard.writeText(emails);
    alert(`${filteredPlayers.filter(p => p.email).length} emails copiados!`);
  };

  const copyPhones = () => {
    const phones = filteredPlayers
      .filter(p => p.phone_number)
      .map(p => p.phone_number)
      .join(', ');
    navigator.clipboard.writeText(phones);
    alert(`${filteredPlayers.filter(p => p.phone_number).length} telefones copiados!`);
  };

  const openWhatsApp = (phone: string) => {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
  };

  const getCategoryBadgeColor = (category: PlayerCategory) => {
    if (!category) return 'bg-gray-100 text-gray-500';
    const level = parseInt(category.charAt(1));
    if (level >= 5) return 'bg-green-100 text-green-700';
    if (level >= 3) return 'bg-blue-100 text-blue-700';
    return 'bg-amber-100 text-amber-700';
  };

  // Sincronizar scroll horizontal entre tabela e barra fixa
  useEffect(() => {
    if (!isOpen || filteredPlayers.length === 0) return;

    const tableContainer = document.getElementById('table-scroll-container');
    const horizontalScrollbar = document.getElementById('horizontal-scrollbar');
    
    if (!tableContainer || !horizontalScrollbar) return;

    // Calcular largura da tabela
    const table = tableContainer.querySelector('table');
    if (table) {
      const tableWidth = table.scrollWidth;
      const scrollbarContent = horizontalScrollbar.querySelector('div');
      if (scrollbarContent) {
        scrollbarContent.style.width = `${tableWidth}px`;
      }
    }

    // Sincronizar scroll da tabela com a barra fixa
    const handleTableScroll = () => {
      horizontalScrollbar.scrollLeft = tableContainer.scrollLeft;
    };

    // Sincronizar scroll da barra fixa com a tabela
    const handleScrollbarScroll = () => {
      tableContainer.scrollLeft = horizontalScrollbar.scrollLeft;
    };

    tableContainer.addEventListener('scroll', handleTableScroll);
    horizontalScrollbar.addEventListener('scroll', handleScrollbarScroll);

    return () => {
      tableContainer.removeEventListener('scroll', handleTableScroll);
      horizontalScrollbar.removeEventListener('scroll', handleScrollbarScroll);
    };
  }, [isOpen, filteredPlayers.length]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Todos os Jogadores</h2>
                <p className="text-xs text-gray-500">
                  {filteredPlayers.length} jogadores unicos
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Pesquisar por nome, email ou telefone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors sm:hidden text-sm"
            >
              <Filter className="w-4 h-4" />
              Filtros
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
            </button>

            <div className="hidden sm:flex gap-1.5">
              <div className="relative">
                <Trophy className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedTournament}
                  onChange={(e) => setSelectedTournament(e.target.value)}
                  className="pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent appearance-none bg-white min-w-[140px]"
                >
                  <option value="all">Todos os torneios</option>
                  {tournaments.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>

              <div className="relative">
                <Tag className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent appearance-none bg-white min-w-[120px]"
                >
                  <option value="all">Todas categorias</option>
                  <option value="none">Sem categoria</option>
                  <optgroup label="Masculino">
                    {PLAYER_CATEGORIES.filter(c => c.gender === 'M').map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Feminino">
                    {PLAYER_CATEGORIES.filter(c => c.gender === 'F').map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </optgroup>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {showFilters && (
            <div className="mt-2 flex flex-col gap-1.5 sm:hidden">
              <div className="relative">
                <Trophy className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedTournament}
                  onChange={(e) => setSelectedTournament(e.target.value)}
                  className="w-full pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
                >
                  <option value="all">Todos os torneios</option>
                  {tournaments.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>
              <div className="relative">
                <Tag className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full pl-7 pr-6 py-1.5 text-xs border border-gray-200 rounded-lg focus:ring-1 focus:ring-blue-500 focus:border-transparent appearance-none bg-white"
                >
                  <option value="all">Todas categorias</option>
                  <option value="none">Sem categoria</option>
                  <optgroup label="Masculino">
                    {PLAYER_CATEGORIES.filter(c => c.gender === 'M').map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Feminino">
                    {PLAYER_CATEGORIES.filter(c => c.gender === 'F').map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </optgroup>
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mt-3">
            <button
              onClick={exportToCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
            <button
              onClick={copyEmails}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
            >
              <Mail className="w-3.5 h-3.5" />
              Emails ({filteredPlayers.filter(p => p.email).length})
            </button>
            <button
              onClick={copyPhones}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors text-xs font-medium"
            >
              <Phone className="w-3.5 h-3.5" />
              Telefones ({filteredPlayers.filter(p => p.phone_number).length})
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col overflow-hidden relative">
          <style>{`
            .table-scroll-wrapper {
              overflow-x: scroll !important;
              overflow-y: visible;
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .table-scroll-wrapper::-webkit-scrollbar {
              display: none;
            }
            .table-content-wrapper {
              overflow-y: auto;
              overflow-x: hidden;
              flex: 1;
              padding-bottom: 12px;
            }
            .table-horizontal-scrollbar {
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              height: 12px;
              overflow-x: scroll;
              overflow-y: hidden;
              scrollbar-width: thin;
              scrollbar-color: #cbd5e1 #f1f5f9;
              background: #f1f5f9;
              z-index: 30;
              border-top: 1px solid #e2e8f0;
            }
            .table-horizontal-scrollbar::-webkit-scrollbar {
              height: 8px;
              display: block !important;
            }
            .table-horizontal-scrollbar::-webkit-scrollbar-track {
              background: #f1f5f9;
            }
            .table-horizontal-scrollbar::-webkit-scrollbar-thumb {
              background: #cbd5e1;
              border-radius: 4px;
            }
            .table-horizontal-scrollbar::-webkit-scrollbar-thumb:hover {
              background: #94a3b8;
            }
          `}</style>
          <div className="table-content-wrapper">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              </div>
            ) : filteredPlayers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-gray-500">
                <Users className="w-16 h-16 text-gray-300 mb-4" />
                <p className="text-lg font-medium">Nenhum jogador encontrado</p>
                <p className="text-sm">Tente ajustar os filtros de pesquisa</p>
              </div>
            ) : (
              <div className="table-scroll-wrapper" id="table-scroll-container">
                <table className="text-xs" style={{ minWidth: '100%', width: 'max-content' }}>
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Nome
                    </th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Telefone
                    </th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Categoria
                    </th>
                    <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Nível
                    </th>
                    <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Fiabilidade
                    </th>
                    <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Torneios
                    </th>
                    <th className="px-2 py-2 text-center text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                      Acoes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPlayers.map((player) => (
                    <tr key={player.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-blue-600 font-semibold text-[10px]">
                              {player.displayName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="font-medium text-gray-900 text-xs truncate max-w-[120px]" title={player.displayName}>
                            {player.displayName}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {player.email ? (
                          <a
                            href={`mailto:${player.email}`}
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                          >
                            <Mail className="w-3 h-3" />
                            <span className="text-[10px] truncate max-w-[120px]" title={player.email}>
                              {player.email}
                            </span>
                          </a>
                        ) : (
                          <span className="text-gray-400 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {player.phone_number ? (
                          <span className="flex items-center gap-1 text-gray-700">
                            <Phone className="w-3 h-3 text-gray-400" />
                            <span className="text-[10px] truncate max-w-[100px]" title={player.phone_number}>
                              {player.phone_number}
                            </span>
                          </span>
                        ) : (
                          <span className="text-gray-400 text-[10px]">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="relative">
                          <select
                            value={player.player_category || ''}
                            onChange={(e) => updatePlayerCategory(player, e.target.value as PlayerCategory || null)}
                            disabled={savingCategory === player.id}
                            className={`px-1.5 py-1 text-[10px] font-medium rounded border-0 cursor-pointer focus:ring-1 focus:ring-blue-500 appearance-none pr-5 ${getCategoryBadgeColor(player.player_category)} ${savingCategory === player.id ? 'opacity-50' : ''}`}
                          >
                            <option value="">Sem cat.</option>
                            <optgroup label="Masculino">
                              {PLAYER_CATEGORIES.filter(c => c.gender === 'M').map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Feminino">
                              {PLAYER_CATEGORIES.filter(c => c.gender === 'F').map(c => (
                                <option key={c.value} value={c.value}>{c.label}</option>
                              ))}
                            </optgroup>
                          </select>
                          <ChevronDown className="absolute right-0.5 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none opacity-60" />
                        </div>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {editingLevel === player.id ? (
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            max="10"
                            value={editLevelValue}
                            onChange={(e) => setEditLevelValue(e.target.value)}
                            className="w-12 px-1 py-0.5 text-[10px] border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 text-center"
                            autoFocus
                          />
                        ) : (
                          <div className="flex items-center justify-center gap-0.5">
                            {player.level != null ? (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-semibold">
                                <Gauge className="w-2.5 h-2.5" />
                                {Number(player.level).toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-gray-400 text-[10px]">-</span>
                            )}
                            {player.phone_number && (
                              <button
                                onClick={() => {
                                  setEditingLevel(player.id);
                                  setEditLevelValue(player.level != null ? String(player.level) : '');
                                  setEditReliabilityValue(player.level_reliability_percent != null ? String(player.level_reliability_percent) : '');
                                }}
                                className="p-0.5 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Editar nível"
                              >
                                <Edit3 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {editingLevel === player.id ? (
                          <div className="flex items-center justify-center gap-0.5">
                            <input
                              type="number"
                              step="1"
                              min="0"
                              max="100"
                              value={editReliabilityValue}
                              onChange={(e) => setEditReliabilityValue(e.target.value)}
                              className="w-12 px-1 py-0.5 text-[10px] border border-blue-300 rounded focus:ring-1 focus:ring-blue-500 text-center"
                            />
                            <span className="text-[9px] text-gray-400">%</span>
                            <button
                              onClick={() => updatePlayerLevel(player)}
                              disabled={savingLevel === player.id}
                              className="p-0.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Guardar"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setEditingLevel(null)}
                              className="p-0.5 text-gray-400 hover:bg-gray-100 rounded transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          player.level_reliability_percent != null ? (
                            <div className="flex items-center justify-center gap-1">
                              <div className="w-12 bg-gray-200 rounded-full h-1.5" title={`${Math.round(Number(player.level_reliability_percent))}%`}>
                                <div 
                                  className={`h-1.5 rounded-full ${
                                    Number(player.level_reliability_percent) >= 70 ? 'bg-green-500' :
                                    Number(player.level_reliability_percent) >= 40 ? 'bg-yellow-500' : 'bg-red-400'
                                  }`}
                                  style={{ width: `${Math.min(100, Math.max(0, Number(player.level_reliability_percent)))}%` }}
                                />
                              </div>
                              <span className="text-[9px] text-gray-500 font-medium">
                                {Math.round(Number(player.level_reliability_percent))}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-gray-400 text-[10px]">-</span>
                          )
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <div className="relative">
                          <button
                            onClick={() => {
                              const newExpanded = new Set(expandedPlayers);
                              if (newExpanded.has(player.id)) {
                                newExpanded.delete(player.id);
                              } else {
                                newExpanded.add(player.id);
                              }
                              setExpandedPlayers(newExpanded);
                            }}
                            className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-800 font-medium"
                          >
                            <Trophy className="w-3 h-3" />
                            <span>{player.tournaments.length}</span>
                            {expandedPlayers.has(player.id) ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                          
                          {expandedPlayers.has(player.id) && (
                            <div className="absolute z-20 left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                              <div className="p-1.5 bg-gray-50 border-b border-gray-200 sticky top-0">
                                <p className="text-[9px] font-semibold text-gray-600">
                                  Torneios ({player.tournaments.length})
                                </p>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {player.tournaments.map((t, idx) => {
                                  const date = new Date(t.date);
                                  const formattedDate = `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
                                  return (
                                    <div key={t.id} className="px-2 py-1.5 hover:bg-gray-50 flex items-center gap-2">
                                      <div className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                                        <span className="text-[9px] font-bold text-blue-600">{idx + 1}</span>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-[10px] font-medium text-gray-900 truncate" title={t.name}>
                                          {t.name}
                                        </p>
                                        <p className="text-[9px] text-gray-500 flex items-center gap-0.5">
                                          <Calendar className="w-2.5 h-2.5" />
                                          {formattedDate}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-center gap-1">
                          {player.phone_number && (
                            <button
                              onClick={() => openWhatsApp(player.phone_number!)}
                              className="p-1 text-green-600 hover:bg-green-50 rounded transition-colors"
                              title="Abrir WhatsApp"
                            >
                              <MessageCircle className="w-4 h-4" />
                            </button>
                          )}
                          {player.email && (
                            <a
                              href={`mailto:${player.email}`}
                              className="p-1 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                              title="Enviar email"
                            >
                              <Mail className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            )}
          </div>
          {!loading && filteredPlayers.length > 0 && (
            <div 
              className="table-horizontal-scrollbar"
              id="horizontal-scrollbar"
            >
              <div style={{ height: '1px' }}></div>
            </div>
          )}
        </div>

        <div className="p-3 border-t border-gray-100 bg-gray-50">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
            <div className="flex items-center gap-3">
              <span>
                <strong>{filteredPlayers.length}</strong> jogadores
              </span>
              <span>
                <strong>{filteredPlayers.filter(p => p.email).length}</strong> email
              </span>
              <span>
                <strong>{filteredPlayers.filter(p => p.phone_number).length}</strong> telefone
              </span>
              <span>
                <strong>{filteredPlayers.filter(p => p.player_category).length}</strong> categoria
              </span>
            </div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-200 rounded-lg transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
