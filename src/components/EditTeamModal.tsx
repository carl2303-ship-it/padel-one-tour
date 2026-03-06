import { useState, useEffect } from 'react';
import { supabase, Team, TournamentCategory } from '../lib/supabase';
import { X, Trash2 } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';

type Player = {
  id: string;
  name: string;
  email: string | null;
  phone_number: string | null;
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

  useEffect(() => {
    fetchCategories();
    fetchPlayers();
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

    const { data: userTournaments } = await supabase
      .from('tournaments')
      .select('id')
      .eq('user_id', user.id);

    if (!userTournaments || userTournaments.length === 0) {
      return;
    }

    const tournamentIds = userTournaments.map(t => t.id);

    const { data } = await supabase
      .from('players')
      .select('id, name, email, phone_number')
      .in('tournament_id', tournamentIds)
      .order('name');

    if (data) {
      const uniquePlayers = data.reduce((acc: typeof data, player) => {
        const key = player.phone_number?.replace(/\s+/g, '') || player.name;
        const existing = acc.find(p =>
          (p.phone_number?.replace(/\s+/g, '') === key) ||
          (!p.phone_number && !player.phone_number && p.name === player.name)
        );
        if (!existing) {
          acc.push(player);
        }
        return acc;
      }, []);

      setAvailablePlayers(uniquePlayers);
    }
  };

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
        await supabase
          .from('players')
          .update({ category_id: categoryId })
          .eq('id', playerId);
      }
      return playerId;
    }

    // Jogador está noutro torneio - verificar se já existe neste torneio pelo telefone/nome
    const { data: playerInThisTournament } = await supabase
      .from('players')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('phone_number', existingPlayer.phone_number || '')
      .maybeSingle();

    if (playerInThisTournament) {
      // Já existe neste torneio, atualizar categoria se necessário
      if (categoryId) {
        await supabase
          .from('players')
          .update({ category_id: categoryId })
          .eq('id', playerInThisTournament.id);
      }
      return playerInThisTournament.id;
    }

    // Criar cópia do jogador para este torneio
    const { data: newPlayer, error } = await supabase
      .from('players')
      .insert([{
        name: existingPlayer.name,
        email: existingPlayer.email,
        phone_number: existingPlayer.phone_number,
        user_id: null,
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

  // Verificar se um jogador ainda está noutra equipa do mesmo torneio
  const isPlayerInOtherTeam = async (playerId: string, excludeTeamId: string): Promise<boolean> => {
    try {
      // Primeiro, verificar se a equipa atual ainda tem este jogador (não deveria acontecer)
      const { data: currentTeam } = await supabase
        .from('teams')
        .select('player1_id, player2_id')
        .eq('id', excludeTeamId)
        .single();

      if (currentTeam && (currentTeam.player1_id === playerId || currentTeam.player2_id === playerId)) {
        console.warn(`[EDIT-TEAM] ⚠️ ATENÇÃO: A equipa atual ainda tem o jogador ${playerId}! Isso não deveria acontecer.`);
      }

      // Verificar player1_id em outras equipas
      const { data: teamsAsPlayer1 } = await supabase
        .from('teams')
        .select('id, name')
        .eq('tournament_id', tournamentId)
        .eq('player1_id', playerId)
        .neq('id', excludeTeamId)
        .limit(5);

      // Verificar player2_id em outras equipas
      const { data: teamsAsPlayer2 } = await supabase
        .from('teams')
        .select('id, name')
        .eq('tournament_id', tournamentId)
        .eq('player2_id', playerId)
        .neq('id', excludeTeamId)
        .limit(5);

      const inOtherTeam = ((teamsAsPlayer1?.length || 0) > 0) || ((teamsAsPlayer2?.length || 0) > 0);
      
      console.log(`[EDIT-TEAM] Jogador ${playerId} está noutra equipa?`, inOtherTeam, {
        teamsAsPlayer1: teamsAsPlayer1?.map(t => ({ id: t.id, name: t.name })) || [],
        teamsAsPlayer2: teamsAsPlayer2?.map(t => ({ id: t.id, name: t.name })) || []
      });

      return inOtherTeam;
    } catch (error) {
      console.error('[EDIT-TEAM] Erro ao verificar se jogador está noutra equipa:', error);
      // Em caso de erro, assumir que está noutra equipa para evitar remoção acidental
      return true;
    }
  };

  // Remover jogador da tabela players se não estiver noutra equipa
  const cleanupOldPlayer = async (oldPlayerId: string) => {
    if (!oldPlayerId) {
      console.log('[EDIT-TEAM] cleanupOldPlayer: oldPlayerId vazio, ignorando');
      return;
    }

    console.log(`[EDIT-TEAM] Iniciando cleanup para jogador: ${oldPlayerId}`);

    const stillInOtherTeam = await isPlayerInOtherTeam(oldPlayerId, team.id);
    
    if (stillInOtherTeam) {
      console.log(`[EDIT-TEAM] Jogador ${oldPlayerId} ainda está noutra equipa, não removendo`);
      return;
    }

    console.log(`[EDIT-TEAM] Jogador ${oldPlayerId} não está noutra equipa, verificando se pode ser removido...`);

    // Verificar se o jogador está no torneio atual
    const { data: player, error: playerError } = await supabase
      .from('players')
      .select('id, tournament_id, name')
      .eq('id', oldPlayerId)
      .single();

    if (playerError) {
      console.error('[EDIT-TEAM] Erro ao buscar jogador:', playerError);
      return;
    }

    if (!player) {
      console.log(`[EDIT-TEAM] Jogador ${oldPlayerId} não encontrado na tabela players`);
      return;
    }

    // Só remover se estiver no torneio atual
    if (player.tournament_id === tournamentId) {
      // Verificar se o jogador está referenciado em matches individuais
      const [match1, match2, match3, match4] = await Promise.all([
        supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('player1_individual_id', oldPlayerId).limit(1),
        supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('player2_individual_id', oldPlayerId).limit(1),
        supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('player3_individual_id', oldPlayerId).limit(1),
        supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('player4_individual_id', oldPlayerId).limit(1),
      ]);

      const hasMatches = 
        (match1.data && match1.data.length > 0) ||
        (match2.data && match2.data.length > 0) ||
        (match3.data && match3.data.length > 0) ||
        (match4.data && match4.data.length > 0);

      if (match1.error || match2.error || match3.error || match4.error) {
        console.error('[EDIT-TEAM] Erro ao verificar matches:', match1.error || match2.error || match3.error || match4.error);
      }

      if (hasMatches) {
        console.log(`[EDIT-TEAM] Jogador ${oldPlayerId} está referenciado em matches individuais, não removendo`);
        return;
      }

      console.log(`[EDIT-TEAM] Removendo jogador ${oldPlayerId} (${player.name}) da tabela players...`);
      
      const { data: deletedData, error: deleteError } = await supabase
        .from('players')
        .delete()
        .eq('id', oldPlayerId)
        .select();

      if (deleteError) {
        console.error('[EDIT-TEAM] Erro ao remover jogador antigo:', deleteError);
        console.error('[EDIT-TEAM] Detalhes do erro:', JSON.stringify(deleteError, null, 2));
        
        // Se o erro for de foreign key constraint, tentar atualizar em vez de remover
        if (deleteError.code === '23503' || deleteError.message?.includes('foreign key')) {
          console.log('[EDIT-TEAM] Erro de foreign key detectado. O jogador pode estar referenciado noutras tabelas.');
          console.log('[EDIT-TEAM] Considerar marcar o jogador como inativo em vez de remover.');
        }
      } else {
        console.log(`[EDIT-TEAM] ✅ Jogador antigo removido com sucesso: ${oldPlayerId} (${player.name})`);
        console.log('[EDIT-TEAM] Dados removidos:', deletedData);
        
        // Verificar se o jogador foi realmente removido
        const { data: verifyPlayer } = await supabase
          .from('players')
          .select('id')
          .eq('id', oldPlayerId)
          .maybeSingle();
        
        if (verifyPlayer) {
          console.warn(`[EDIT-TEAM] ⚠️ ATENÇÃO: Jogador ${oldPlayerId} ainda existe após tentativa de remoção!`);
        } else {
          console.log(`[EDIT-TEAM] ✅ Confirmado: Jogador ${oldPlayerId} foi removido com sucesso`);
        }
      }
    } else {
      console.log(`[EDIT-TEAM] Jogador ${oldPlayerId} está noutro torneio (${player.tournament_id}), não removendo`);
    }
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

        // Limpar jogadores antigos se não estiverem noutras equipas
        console.log('[EDIT-TEAM] Verificando jogadores antigos para remover:', {
          oldPlayer1Id,
          finalPlayer1Id,
          player1Changed: oldPlayer1Id !== finalPlayer1Id,
          oldPlayer2Id,
          finalPlayer2Id,
          player2Changed: oldPlayer2Id !== finalPlayer2Id
        });

        if (oldPlayer1Id && oldPlayer1Id !== finalPlayer1Id) {
          console.log('[EDIT-TEAM] Player1 mudou, iniciando cleanup...');
          await cleanupOldPlayer(oldPlayer1Id);
        } else {
          console.log('[EDIT-TEAM] Player1 não mudou ou é null, não removendo');
        }

        if (oldPlayer2Id && oldPlayer2Id !== finalPlayer2Id) {
          console.log('[EDIT-TEAM] Player2 mudou, iniciando cleanup...');
          await cleanupOldPlayer(oldPlayer2Id);
        } else {
          console.log('[EDIT-TEAM] Player2 não mudou ou é null, não removendo');
        }

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
      const { error: deleteError } = await supabase
        .from('teams')
        .delete()
        .eq('id', team.id);

      if (deleteError) {
        setError(deleteError.message);
        setLoading(false);
      } else {
        onSuccess();
      }
    } catch (err) {
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
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.team.player1} *</label>
            <select
              required
              value={player1Id}
              onChange={(e) => setPlayer1Id(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">{t.team.selectPlayer1}</option>
              {availablePlayers.map((player) => (
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
              {availablePlayers.map((player) => (
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
                  const formatLabel = category.format === 'single_elimination' ? 'Single Elimination' :
                    category.format === 'round_robin' ? 'Round Robin' :
                    category.format === 'individual_groups_knockout' ? 'Individual Groups + Knockout' : 'Groups + Knockout';
                  return (
                    <option key={category.id} value={category.id}>
                      {category.name} - {formatLabel}
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
