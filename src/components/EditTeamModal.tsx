import { useState, useEffect, useMemo } from 'react';
import { supabase, Team, TournamentCategory } from '../lib/supabase';
import {
  fetchAllOrganizerPlayers,
  getOrganizerTournamentIds,
  isSameOrganizerPlayer,
  searchOrganizerPlayers,
} from '../lib/organizerPlayerSearch';
import { normalizePhone } from '../lib/phoneUtils';
import { X, Trash2, Search } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';

type Player = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
  tournament_id?: string | null;
  player_account_id?: string | null;
};

type EditTeamModalProps = {
  team: Team;
  tournamentId: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditTeamModal({ team, tournamentId, onClose, onSuccess }: EditTeamModalProps) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<Player[]>([]);
  const [teamName, setTeamName] = useState(team.name);
  const [categoryId, setCategoryId] = useState<string>(team.category_id || '');
  const [seed, setSeed] = useState<number | ''>(team.seed || '');
  const [player1Id, setPlayer1Id] = useState(team.player1_id);
  const [player2Id, setPlayer2Id] = useState(team.player2_id);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [tournamentIds, setTournamentIds] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<Player[] | null>(null);

  useEffect(() => {
    fetchCategories();
    void fetchPlayers();
  }, []);

  const fetchCategories = async () => {
    const { data } = await supabase
      .from('tournament_categories')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('name');

    if (data) {
      setCategories(data);
    }
  };

  const fetchPlayers = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const ids = await getOrganizerTournamentIds(user.id);
    setTournamentIds(ids);
    if (!ids.length) return;

    const [all, currentPlayersResult] = await Promise.all([
      fetchAllOrganizerPlayers(ids, tournamentId),
      supabase
        .from('players')
        .select('id, name, email, phone_number, tournament_id')
        .in('id', [team.player1_id, team.player2_id].filter(Boolean)),
    ]);
    if (currentPlayersResult.error) throw currentPlayersResult.error;

    const mergedPlayers = [...all];
    for (const player of currentPlayersResult.data || []) {
      const existingIndex = mergedPlayers.findIndex(existing =>
        isSameOrganizerPlayer(existing, player)
      );
      if (existingIndex === -1) {
        mergedPlayers.push(player);
      } else {
        const existing = mergedPlayers[existingIndex];
        mergedPlayers[existingIndex] = {
          ...existing,
          ...player,
          email: player.email || existing.email,
          phone_number: normalizePhone(player.phone_number || existing.phone_number) || null,
        };
      }
    }

    const sorted = mergedPlayers.sort((a, b) => {
      const aInTournament = a.tournament_id === tournamentId ? 0 : 1;
      const bInTournament = b.tournament_id === tournamentId ? 0 : 1;
      if (aInTournament !== bInTournament) return aInTournament - bInTournament;
      return a.name.localeCompare(b.name, 'pt');
    });
    setAvailablePlayers(sorted);
  };

  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      if (!tournamentIds.length) return;
      const results = await searchOrganizerPlayers(tournamentIds, term, tournamentId);
      setSearchResults(results);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, tournamentIds]);

  const displayPlayers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const base = searchResults ?? availablePlayers;
    const filtered = !term || term.length < 2
      ? base
      : searchResults || base.filter(p => p.name.toLowerCase().includes(term));
    const selectedPlayers = availablePlayers.filter(
      player => player.id === player1Id || player.id === player2Id
    );
    return [...new Map([...selectedPlayers, ...filtered].map(player => [player.id, player])).values()];
  }, [availablePlayers, player1Id, player2Id, searchResults, searchTerm]);

  // Garantir que o jogador existe no torneio atual (copiar se necessário)
  const ensurePlayerInTournament = async (playerId: string): Promise<string> => {
    // Verificar se o jogador já está no torneio atual
    const { data: existingPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (!existingPlayer) {
      throw new Error('Jogador não encontrado');
    }

    // Se já está no torneio atual, atualizar categoria se necessário e retornar o mesmo ID
    if (existingPlayer.tournament_id === tournamentId) {
      // Atualizar category_id se necessário
      if (categoryId && existingPlayer.category_id !== categoryId) {
        const { error } = await supabase
          .from('players')
          .update({ category_id: categoryId })
          .eq('id', playerId);
        if (error) throw error;
      }
      return playerId;
    }

    // Jogador está noutro torneio - verificar identidade normalizada na mesma categoria
    let matchingPlayersQuery = supabase
      .from('players')
      .select('id, name, email, phone_number, player_account_id')
      .eq('tournament_id', tournamentId);
    matchingPlayersQuery = categoryId
      ? matchingPlayersQuery.eq('category_id', categoryId)
      : matchingPlayersQuery.is('category_id', null);

    const { data: tournamentPlayers, error: lookupError } = await matchingPlayersQuery;
    if (lookupError) throw lookupError;
    const playerInThisTournament = tournamentPlayers?.find(player =>
      isSameOrganizerPlayer(existingPlayer, player)
    );

    if (playerInThisTournament) {
      const updates: Record<string, string> = {};
      if (!playerInThisTournament.email && existingPlayer.email) updates.email = existingPlayer.email;
      const normalizedPhone = normalizePhone(existingPlayer.phone_number);
      if (normalizedPhone) updates.phone_number = normalizedPhone;
      if (Object.keys(updates).length) {
        const { error } = await supabase
          .from('players')
          .update(updates)
          .eq('id', playerInThisTournament.id);
        if (error) throw error;
      }
      return playerInThisTournament.id;
    }

    // Criar cópia do jogador para este torneio
    const { data: newPlayer, error } = await supabase
      .from('players')
      .insert([{
        name: existingPlayer.name,
        email: existingPlayer.email,
        phone_number: normalizePhone(existingPlayer.phone_number) || null,
        user_id: existingPlayer.user_id,
        player_account_id: existingPlayer.player_account_id,
        tournament_id: tournamentId,
        category_id: categoryId || null
      }])
      .select()
      .single();

    if (error) throw error;

    console.log(`[EDIT-TEAM] Jogador "${existingPlayer.name}" copiado para o torneio atual`);
    await fetchPlayers();
    return newPlayer.id;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!player1Id || !player2Id) {
      setError(t.team.bothPlayersRequired);
      setLoading(false);
      return;
    }

    if (player1Id === player2Id) {
      setError(t.team.playersMustBeDifferent);
      setLoading(false);
      return;
    }

    try {
      console.log('[EDIT-TEAM] Updating team:', {
        id: team.id,
        name: teamName,
        old_player1_id: team.player1_id,
        new_player1_id: player1Id,
        old_player2_id: team.player2_id,
        new_player2_id: player2Id
      });

      // Guardar IDs antigos antes de atualizar
      const oldPlayer1Id = team.player1_id;
      const oldPlayer2Id = team.player2_id;

      // Garantir que os novos jogadores existem no torneio atual
      let finalPlayer1Id = player1Id;
      let finalPlayer2Id = player2Id;

      if (player1Id !== oldPlayer1Id) {
        finalPlayer1Id = await ensurePlayerInTournament(player1Id);
      } else if (categoryId !== team.category_id) {
        // Jogador não mudou mas categoria mudou - atualizar categoria
        await supabase
          .from('players')
          .update({ category_id: categoryId || null })
          .eq('id', player1Id);
      }

      if (player2Id !== oldPlayer2Id) {
        finalPlayer2Id = await ensurePlayerInTournament(player2Id);
      } else if (categoryId !== team.category_id) {
        // Jogador não mudou mas categoria mudou - atualizar categoria
        await supabase
          .from('players')
          .update({ category_id: categoryId || null })
          .eq('id', player2Id);
      }

      // Atualizar a equipa
      const { data, error: updateError } = await supabase
        .from('teams')
        .update({
          name: teamName,
          seed: seed === '' ? null : seed,
          category_id: categoryId || null,
          player1_id: finalPlayer1Id,
          player2_id: finalPlayer2Id,
        })
        .eq('id', team.id)
        .select('*, player1:players!teams_player1_id_fkey(*), player2:players!teams_player2_id_fkey(*)');

      console.log('[EDIT-TEAM] Update result:', { data, error: updateError });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
      } else {
        console.log('[EDIT-TEAM] Team updated successfully');

        // Atualizar lista de jogadores disponíveis
        await fetchPlayers();

        console.log('[EDIT-TEAM] Calling onSuccess');
        onSuccess();
      }
    } catch (err) {
      console.error('[EDIT-TEAM] Exception:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this team? This will remove the team from all tournament configurations and matches.')) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const [m1, m2] = await Promise.all([
        supabase.from('matches').select('id').eq('team1_id', team.id),
        supabase.from('matches').select('id').eq('team2_id', team.id),
      ]);
      const matchIds = [...new Set([
        ...(m1.data || []).map(m => m.id),
        ...(m2.data || []).map(m => m.id),
      ])];

      if (matchIds.length > 0) {
        await supabase.from('court_bookings').delete().in('tournament_match_id', matchIds);
        for (const matchId of matchIds) {
          await supabase.from('matches').delete().eq('id', matchId);
        }
      }

      const { error: deleteError } = await supabase
        .from('teams')
        .delete()
        .eq('id', team.id);

      if (deleteError) {
        setError(deleteError.message);
        setLoading(false);
        return;
      }

      const playerIds = [team.player1_id, team.player2_id].filter(Boolean);
      for (const pid of playerIds) {
        await supabase.from('players').delete().eq('id', pid);
      }

      onSuccess();
    } catch {
      setError('An unexpected error occurred');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{t.team.edit}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.team.name} *</label>
            <input
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Thunder Strikers"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Pesquisar jogador</label>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Mín. 2 letras..."
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.team.player1} *</label>
            <select
              required
              value={player1Id}
              onChange={(e) => setPlayer1Id(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">{t.team.selectPlayer1}</option>
              {displayPlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} {player.email ? `(${player.email})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.team.player2} *</label>
            <select
              required
              value={player2Id}
              onChange={(e) => setPlayer2Id(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">{t.team.selectPlayer2}</option>
              {displayPlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} {player.email ? `(${player.email})` : ''}
                </option>
              ))}
            </select>
          </div>

          {categories.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">No Category</option>
                {categories.map((category) => {
                  return (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.team.seedOptional}</label>
            <input
              type="number"
              min="1"
              max="120"
              value={seed}
              onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value) : '')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="1-120"
            />
            <p className="text-sm text-gray-500 mt-1">{t.team.seedDescription}</p>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-200 mt-6">
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors font-medium disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {t.team.delete}
            </button>
            <div className="flex-1 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
              >
                {t.button.cancel}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
              >
                {loading ? t.button.saving : t.button.saveChanges}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
