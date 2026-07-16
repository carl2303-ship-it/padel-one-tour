import { useState, useEffect } from 'react';
import { supabase, TournamentCategory } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { X } from 'lucide-react';
import { createClient } from '@supabase/supabase-js';

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

type AddIndividualPlayerModalProps = {
  tournamentId: string;
  categoryId?: string | null;
  onClose: () => void;
  onSuccess: () => void;
};

type ExistingPlayer = {
  id: string;
  name: string;
  phone_number: string | null;
  email?: string | null;
};

function normalizePlayerName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function normalizePlayerPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  let hadPrefix = false;
  if (cleaned.startsWith('+00')) { cleaned = cleaned.slice(3); hadPrefix = true; }
  else if (cleaned.startsWith('+')) { cleaned = cleaned.slice(1); hadPrefix = true; }
  else if (cleaned.startsWith('00')) { cleaned = cleaned.slice(2); hadPrefix = true; }
  
  if (hadPrefix) {
    cleaned = cleaned.replace(/^(351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|212|213|216|244|245|258|297|298|299|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|992|993|994|995|996|997|998)(?=\d{7,})/, '');
    cleaned = cleaned.replace(/^(20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)(?=\d{7,})/, '');
    cleaned = cleaned.replace(/^[17](?=\d{9,})/, '');
  } else {
    cleaned = cleaned.replace(/^351(?=[29]\d{8}$)/, '');
  }
  
  if (cleaned.startsWith('0') && cleaned.length >= 9) {
    cleaned = cleaned.slice(1);
  }
  
  return cleaned;
}

type Tournament = {
  id: string;
  name: string;
  has_dinner_option?: boolean;
};

export default function AddIndividualPlayerModal({
  tournamentId,
  categoryId,
  onClose,
  onSuccess,
}: AddIndividualPlayerModalProps) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'select' | 'new'>('select');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>('');
  const [existingPlayers, setExistingPlayers] = useState<ExistingPlayer[]>([]);
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    categoryId && categoryId !== 'no-category' ? categoryId : ''
  );
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
  });
  const [seed, setSeed] = useState<number | ''>('');
  const [wantsDinner, setWantsDinner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (user) {
      fetchExistingPlayers();
    }
    fetchCategories();
    fetchTournament();
  }, [user]);

  const fetchCategories = async () => {
    // Buscar todas as categorias do torneio
    const { data } = await supabase
      .from('tournament_categories')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('name');

    if (data) {
      // Filtrar apenas categorias com formatos individuais
      const individualCategories = data.filter(cat =>
        cat.format === 'round_robin' ||
        cat.format === 'individual_groups_knockout' ||
        cat.format === 'mixed_american'
      );
      setCategories(individualCategories);
    }
  };

  const fetchTournament = async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('id, name, has_dinner_option')
      .eq('id', tournamentId)
      .single();

    if (data) {
      setTournament(data);
    }
  };

  const fetchExistingPlayers = async () => {
    if (!user?.id) return;

    const { data: userTournaments } = await supabase
      .from('tournaments')
      .select('id')
      .eq('user_id', user.id);

    const tournamentIds = userTournaments?.map(t => t.id) || [];

    const [playersResult, teamsResult, organizerResult, accountsResult] = await Promise.all([
      tournamentIds.length > 0
        ? supabase
            .from('players')
            .select('id, name, phone_number, email')
            .in('tournament_id', tournamentIds)
        : Promise.resolve({ data: [] as { id: string; name: string; phone_number: string | null; email: string | null }[] }),
      tournamentIds.length > 0
        ? supabase
            .from('teams')
            .select(`
              player1:players!teams_player1_id_fkey(name, email, phone_number),
              player2:players!teams_player2_id_fkey(name, email, phone_number)
            `)
            .in('tournament_id', tournamentIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from('organizer_players')
        .select('name, email, phone_number')
        .eq('organizer_id', user.id),
      supabase
        .from('player_accounts')
        .select('name, email, phone_number'),
    ]);

    const accountsByPhone = new Map<string, { name: string; email: string | null; phone_number: string }>();
    for (const acc of accountsResult.data || []) {
      const key = normalizePlayerPhone(acc.phone_number);
      if (key) accountsByPhone.set(key, acc);
    }

    const playerMap = new Map<string, ExistingPlayer>();

    const addPlayer = (name: string, phone: string | null | undefined, email: string | null | undefined) => {
      if (!name?.trim()) return;

      const phoneKey = normalizePlayerPhone(phone);
      const normalizedName = normalizePlayerName(name);
      const account = phoneKey ? accountsByPhone.get(phoneKey) : undefined;
      const displayName = (account?.name || name).trim();
      const displayPhone = phoneKey || phone || null;
      const displayEmail = email || account?.email || null;

      if (!phoneKey) {
        const duplicateWithPhone = Array.from(playerMap.values()).find(
          (p) => p.phone_number && normalizePlayerName(p.name) === normalizedName
        );
        if (duplicateWithPhone) {
          if (account?.name) duplicateWithPhone.name = account.name;
          if (!duplicateWithPhone.email && displayEmail) duplicateWithPhone.email = displayEmail;
          return;
        }
      }

      const dedupeKey = phoneKey || `name:${normalizedName}`;

      const existing = playerMap.get(dedupeKey);
      if (existing) {
        if (account?.name) existing.name = account.name;
        if (!existing.email && displayEmail) existing.email = displayEmail;
        if (!existing.phone_number && displayPhone) existing.phone_number = displayPhone;
        return;
      }

      if (phoneKey) {
        const nameOnlyKey = `name:${normalizePlayerName(displayName)}`;
        if (playerMap.has(nameOnlyKey)) {
          playerMap.delete(nameOnlyKey);
        }
      }

      playerMap.set(dedupeKey, {
        id: dedupeKey,
        name: displayName,
        phone_number: displayPhone,
        email: displayEmail,
      });
    };

    for (const p of playersResult.data || []) {
      addPlayer(p.name, p.phone_number, p.email);
    }

    for (const team of teamsResult.data || []) {
      if (team.player1) addPlayer(team.player1.name, team.player1.phone_number, team.player1.email);
      if (team.player2) addPlayer(team.player2.name, team.player2.phone_number, team.player2.email);
    }

    for (const op of organizerResult.data || []) {
      addPlayer(op.name, op.phone_number, op.email);
    }

    const uniquePlayers = Array.from(playerMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'pt')
    );

    setExistingPlayers(uniquePlayers);
    if (uniquePlayers.length === 0) {
      setMode('new');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!selectedCategoryId) {
      setError('Please select a category');
      setLoading(false);
      return;
    }

    if (mode === 'select') {
      if (!selectedPlayerId) {
        setError('Please select a player');
        setLoading(false);
        return;
      }

      const selectedPlayer = existingPlayers.find(p => p.id === selectedPlayerId);
      if (!selectedPlayer) {
        setError('Player not found');
        setLoading(false);
        return;
      }

      const insertData: any = {
        tournament_id: tournamentId,
        category_id: selectedCategoryId,
        name: selectedPlayer.name,
        phone_number: selectedPlayer.phone_number,
        seed: seed === '' ? null : seed,
        user_id: null,
        wants_dinner: wantsDinner,
      };

      console.log('[PLAYER INSERT - EXISTING] Inserindo jogador existente:', insertData);

      // Use a fresh client without auth headers for anonymous inserts
      const clientToUse = user
        ? supabase
        : createClient(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_ANON_KEY,
            {
              auth: { persistSession: false }
            }
          );

      const { error: submitError } = await clientToUse.from('players').insert([insertData]);

      if (submitError) {
        console.error('[PLAYER INSERT ERROR - NEW]:', submitError);
        setError(submitError.message);
        setLoading(false);
      } else {
        // Create or update player_account if user is authenticated and has phone
        if (user?.id && selectedPlayer.phone_number) {
          await supabase
            .from('player_accounts')
            .upsert({
              phone_number: selectedPlayer.phone_number,
              user_id: user.id,
              name: selectedPlayer.name,
              email: selectedPlayer.email || null
            }, {
              onConflict: 'phone_number'
            });
        }

        onSuccess();
        onClose();
      }
    } else {
      if (!formData.name.trim()) {
        setError('Player name is required');
        setLoading(false);
        return;
      }

      if (!formData.email.trim()) {
        setError('Email is required');
        setLoading(false);
        return;
      }

      if (formData.phone.trim()) {
        const normalizedPhone = formData.phone.trim().replace(/[\s\-\(\)\.]/g, '');
        const { data: existingAccount } = await supabase
          .from('player_accounts')
          .select('name')
          .eq('phone_number', normalizedPhone)
          .maybeSingle();

        if (existingAccount && existingAccount.name?.toLowerCase() !== formData.name.trim().toLowerCase()) {
          setError(`Este número já está registado para "${existingAccount.name}". Use o modo "Select Existing" ou corrija o número.`);
          setLoading(false);
          return;
        }
      }

      const insertData: any = {
        tournament_id: tournamentId,
        category_id: selectedCategoryId,
        name: formData.name.trim(),
        seed: seed === '' ? null : seed,
        user_id: null,
        wants_dinner: wantsDinner,
      };

      if (formData.email.trim()) {
        insertData.email = formData.email.trim();
      }
      if (formData.phone.trim()) {
        insertData.phone_number = formData.phone.trim();
      }

      console.log('[PLAYER INSERT - NEW] Inserindo novo jogador:', insertData);

      // Use a fresh client without auth headers for anonymous inserts
      const clientToUse = user
        ? supabase
        : createClient(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_ANON_KEY,
            {
              auth: { persistSession: false }
            }
          );

      const { error: submitError } = await clientToUse.from('players').insert([insertData]);

      if (submitError) {
        console.error('[PLAYER INSERT ERROR - EXISTING]:', submitError);
        setError(submitError.message);
        setLoading(false);
      } else {
        if (formData.email.trim() && tournament) {
          const selectedCategory = categories.find(c => c.id === selectedCategoryId);
          await sendWelcomeEmail(
            formData.email.trim(),
            formData.name.trim(),
            formData.phone.trim(),
            tournament.name,
            selectedCategory?.name
          );
        }

        // Create or update player_account if user is authenticated and has phone
        if (user?.id && formData.phone.trim()) {
          await supabase
            .from('player_accounts')
            .upsert({
              phone_number: formData.phone.trim(),
              user_id: user.id,
              name: formData.name.trim(),
              email: formData.email.trim() || null
            }, {
              onConflict: 'phone_number'
            });
        }

        onSuccess();
        onClose();
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-md w-full">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
          <h2 className="text-2xl font-bold text-gray-900">Add Player</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Category *
            </label>
            <select
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            >
              <option value="">Select a category...</option>
              {categories.map((category) => {
                return (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                );
              })}
            </select>
            {categories.length === 0 && (
              <p className="text-sm text-amber-600 mt-1">
                Nenhuma categoria individual encontrada. Crie primeiro uma categoria com formato individual (Round Robin, Individual Groups + Knockout, Crossed Playoffs ou Mixed Gender).
              </p>
            )}
          </div>

          {existingPlayers.length > 0 && (
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setMode('select')}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  mode === 'select'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Select Existing
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  mode === 'new'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Create New
              </button>
            </div>
          )}

          {mode === 'select' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Player *
              </label>
              <select
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value="">Choose a player...</option>
                {existingPlayers.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} {player.phone_number && `(${player.phone_number})`}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Player Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="John Doe"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone *
                </label>
                <input
                  type="tel"
                  required
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+351 912 345 678"
                />
              </div>
            </>
          )}

          {tournament?.has_dinner_option && (
            <label className="flex items-center gap-3 cursor-pointer py-1">
              <input
                type="checkbox"
                checked={wantsDinner}
                onChange={(e) => setWantsDinner(e.target.checked)}
                className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500"
              />
              <span className="text-sm text-gray-700">🍽️ Quero jantar</span>
            </label>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Seed (opcional)
            </label>
            <input
              type="number"
              min="1"
              max="120"
              value={seed}
              onChange={(e) => setSeed(e.target.value === '' ? '' : parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="1-120"
            />
            <p className="text-sm text-gray-500 mt-1">
              Cabeca de serie para posicionamento no quadro
            </p>
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
              disabled={loading || categories.length === 0}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Adding...' : 'Add Player'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
