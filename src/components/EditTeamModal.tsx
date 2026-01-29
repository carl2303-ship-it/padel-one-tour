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
        player1_id: player1Id,
        player2_id: player2Id
      });

      const { data, error: updateError } = await supabase
        .from('teams')
        .update({
          name: teamName,
          seed: seed === '' ? null : seed,
          category_id: categoryId || null,
          player1_id: player1Id,
          player2_id: player2Id,
        })
        .eq('id', team.id)
        .select('*, player1:players!teams_player1_id_fkey(*), player2:players!teams_player2_id_fkey(*)');

      console.log('[EDIT-TEAM] Update result:', { data, error: updateError });

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
      } else {
        console.log('[EDIT-TEAM] Team updated successfully, calling onSuccess');
        onSuccess();
      }
    } catch (err) {
      console.error('[EDIT-TEAM] Exception:', err);
      setError('An unexpected error occurred');
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
