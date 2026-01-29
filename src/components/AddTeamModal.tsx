import { useState, useEffect } from 'react';
import { supabase, Player, TournamentCategory } from '../lib/supabase';
import { X, Plus, Search } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';

const sendWelcomeEmail = async (
  playerEmail: string,
  playerName: string,
  playerPhone: string,
  tournamentName: string,
  categoryName?: string
) => {
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-player-welcome-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          email: playerEmail,
          tournamentName,
          categoryName,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Failed to send welcome email:', error);
    }
  } catch (error) {
    console.error('Error sending welcome email:', error);
  }
};

type AddTeamModalProps = {
  tournamentId: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function AddTeamModal({ tournamentId, onClose, onSuccess }: AddTeamModalProps) {
  const { t } = useI18n();
  const [players, setPlayers] = useState<Player[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [tournament, setTournament] = useState<{ id: string; name: string } | null>(null);
  const [teamName, setTeamName] = useState('');
  const [player1Id, setPlayer1Id] = useState('');
  const [player2Id, setPlayer2Id] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [seed, setSeed] = useState<number | ''>('');
  const [showNewPlayer1, setShowNewPlayer1] = useState(false);
  const [showNewPlayer2, setShowNewPlayer2] = useState(false);
  const [newPlayer1, setNewPlayer1] = useState({ name: '', email: '', phone_number: '' });
  const [newPlayer2, setNewPlayer2] = useState({ name: '', email: '', phone_number: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchPlayers();
    fetchCategories();
    fetchTournament();
  }, []);

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
      .select('*')
      .in('tournament_id', tournamentIds)
      .order('name', { ascending: true });

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

      setPlayers(uniquePlayers);
    }
  };

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

  const fetchTournament = async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('id', tournamentId)
      .single();

    if (data) {
      setTournament(data);
    }
  };

  const createPlayer = async (playerData: typeof newPlayer1) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // IMPORTANTE: user_id deve ser null para jogadores criados pelo organizador
    // O jogador poderá associar a sua conta depois se quiser
    const { data, error } = await supabase
      .from('players')
      .insert([{
        ...playerData,
        user_id: null, // Não associar ao organizador
        tournament_id: tournamentId,
        category_id: categoryId || null
      }])
      .select()
      .single();

    if (error) throw error;

    if (playerData.email && tournament) {
      const selectedCategory = categories.find(c => c.id === categoryId);
      await sendWelcomeEmail(
        playerData.email,
        playerData.name,
        playerData.phone_number,
        tournament.name,
        selectedCategory?.name
      );
    }

    await fetchPlayers();

    return data.id;
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

    // Se já está no torneio atual, retornar o mesmo ID
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

    console.log(`[ADD_TEAM] Jogador "${existingPlayer.name}" copiado para o torneio atual`);

    // Enviar email de boas-vindas
    if (newPlayer.email && tournament) {
      const selectedCategory = categories.find(c => c.id === categoryId);
      await sendWelcomeEmail(
        newPlayer.email,
        newPlayer.name,
        newPlayer.phone_number || '',
        tournament.name,
        selectedCategory?.name
      );
    }

    await fetchPlayers();
    return newPlayer.id;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let finalPlayer1Id = player1Id;
      let finalPlayer2Id = player2Id;

      if (showNewPlayer1) {
        if (!newPlayer1.name) {
          setError('Nome do Jogador 1 é obrigatório');
          setLoading(false);
          return;
        }
        if (!newPlayer1.email) {
          setError('Email do Jogador 1 é obrigatório');
          setLoading(false);
          return;
        }
        finalPlayer1Id = await createPlayer(newPlayer1);
      } else if (player1Id) {
        // Jogador existente - garantir que está no torneio atual
        finalPlayer1Id = await ensurePlayerInTournament(player1Id);
      }

      if (showNewPlayer2) {
        if (!newPlayer2.name) {
          setError('Nome do Jogador 2 é obrigatório');
          setLoading(false);
          return;
        }
        if (!newPlayer2.email) {
          setError('Email do Jogador 2 é obrigatório');
          setLoading(false);
          return;
        }
        finalPlayer2Id = await createPlayer(newPlayer2);
      } else if (player2Id) {
        // Jogador existente - garantir que está no torneio atual
        finalPlayer2Id = await ensurePlayerInTournament(player2Id);
      }

      if (!finalPlayer1Id || !finalPlayer2Id) {
        setError('Por favor selecione ambos os jogadores');
        setLoading(false);
        return;
      }

      if (finalPlayer1Id === finalPlayer2Id) {
        setError('Por favor selecione jogadores diferentes');
        setLoading(false);
        return;
      }

      const { error: submitError } = await supabase.from('teams').insert([
        {
          tournament_id: tournamentId,
          name: teamName,
          player1_id: finalPlayer1Id,
          player2_id: finalPlayer2Id,
          seed: seed === '' ? null : seed,
          category_id: categoryId || null,
        },
      ]);

      if (submitError) {
        setError(submitError.message);
        setLoading(false);
      } else {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar equipa');
      setLoading(false);
    }
  };

  const filteredPlayers = players.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{t.team.add}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Team Name *</label>
            <input
              type="text"
              required
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="e.g., Thunder Strikers"
            />
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
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Player 1 *</label>
            {showNewPlayer1 ? (
              <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                <input
                  type="text"
                  required
                  value={newPlayer1.name}
                  onChange={(e) => setNewPlayer1({ ...newPlayer1, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Full name"
                />
                <input
                  type="email"
                  required
                  value={newPlayer1.email}
                  onChange={(e) => setNewPlayer1({ ...newPlayer1, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Email *"
                />
                <input
                  type="tel"
                  required
                  value={newPlayer1.phone_number}
                  onChange={(e) => setNewPlayer1({ ...newPlayer1, phone_number: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Phone number *"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPlayer1(false)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Select existing player instead
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Search players..."
                  />
                </div>
                <select
                  value={player1Id}
                  onChange={(e) => setPlayer1Id(e.target.value)}
                  required={!showNewPlayer1}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a player</option>
                  {filteredPlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewPlayer1(true)}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                >
                  <Plus className="w-4 h-4" />
                  Create new player
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Player 2 *</label>
            {showNewPlayer2 ? (
              <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
                <input
                  type="text"
                  required
                  value={newPlayer2.name}
                  onChange={(e) => setNewPlayer2({ ...newPlayer2, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Full name"
                />
                <input
                  type="email"
                  required
                  value={newPlayer2.email}
                  onChange={(e) => setNewPlayer2({ ...newPlayer2, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Email *"
                />
                <input
                  type="tel"
                  required
                  value={newPlayer2.phone_number}
                  onChange={(e) => setNewPlayer2({ ...newPlayer2, phone_number: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Phone number *"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPlayer2(false)}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  Select existing player instead
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <select
                  value={player2Id}
                  onChange={(e) => setPlayer2Id(e.target.value)}
                  required={!showNewPlayer2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select a player</option>
                  {filteredPlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewPlayer2(true)}
                  className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
                >
                  <Plus className="w-4 h-4" />
                  Create new player
                </button>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.team.seedOptional}</label>
            <input
              type="number"
              min="1"
              max="120"
              value={seed}
              onChange={(e) => setSeed(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="1-120"
            />
            <p className="text-sm text-gray-500 mt-1">{t.team.seedDescription}</p>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
