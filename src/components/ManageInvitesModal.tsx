import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import {
  X,
  Search,
  UserPlus,
  Trash2,
  Loader2,
  Mail,
  CheckCircle,
  XCircle,
  Clock,
  Users,
} from 'lucide-react';

interface Invite {
  id: string;
  player_account_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  player_name?: string;
  player_avatar?: string | null;
  player_level?: number | null;
  player_category?: string | null;
}

interface SearchResult {
  id: string;
  name: string;
  avatar_url: string | null;
  level: number | null;
  player_category: string | null;
  phone_number: string | null;
}

interface ManageInvitesModalProps {
  tournamentId: string;
  tournamentName: string;
  onClose: () => void;
}

export default function ManageInvitesModal({ tournamentId, tournamentName, onClose }: ManageInvitesModalProps) {
  const { t } = useI18n();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    loadInvites();
  }, [tournamentId]);

  async function loadInvites() {
    setLoading(true);
    const { data, error } = await supabase
      .from('tournament_invites')
      .select('id, player_account_id, status, created_at')
      .eq('tournament_id', tournamentId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading invites:', error);
      setLoading(false);
      return;
    }

    if (!data || data.length === 0) {
      setInvites([]);
      setLoading(false);
      return;
    }

    const paIds = data.map(d => d.player_account_id);
    const { data: players } = await supabase
      .from('player_accounts')
      .select('id, name, avatar_url, level, player_category')
      .in('id', paIds);

    const playerMap: Record<string, any> = {};
    (players || []).forEach(p => { playerMap[p.id] = p; });

    const enriched: Invite[] = data.map(inv => ({
      ...inv,
      player_name: playerMap[inv.player_account_id]?.name || 'Jogador',
      player_avatar: playerMap[inv.player_account_id]?.avatar_url || null,
      player_level: playerMap[inv.player_account_id]?.level || null,
      player_category: playerMap[inv.player_account_id]?.player_category || null,
    }));

    setInvites(enriched);
    setLoading(false);
  }

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);

    const { data, error } = await supabase.rpc('search_player_accounts_unaccent', {
      search_query: query.trim(),
    });

    if (error) {
      console.error('Error searching:', error);
      setSearchLoading(false);
      return;
    }

    const alreadyInvited = new Set(invites.map(i => i.player_account_id));
    const filtered = (data || []).filter((p: any) => !alreadyInvited.has(p.id));
    setSearchResults(filtered as SearchResult[]);
    setSearchLoading(false);
  }

  async function handleInvite(player: SearchResult) {
    setInviting(player.id);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setInviting(null);
      return;
    }

    const { error } = await supabase.from('tournament_invites').insert({
      tournament_id: tournamentId,
      player_account_id: player.id,
      invited_by: user.id,
      status: 'pending',
    });

    if (error) {
      console.error('Error inviting:', error);
      alert(error.message);
      setInviting(null);
      return;
    }

    // Send push notification
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://rqiwnxcexsccguruiteq.supabase.co';
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJxaXdueGNleHNjY2d1cnVpdGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3Njc5MzcsImV4cCI6MjA3NTM0MzkzN30.Dl05zPQDtPVpmvn_Y-JokT3wDq0Oh9uF3op5xcHZpkY';
      const { data: { session } } = await supabase.auth.getSession();

      fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
          'apikey': supabaseAnonKey,
        },
        body: JSON.stringify({
          playerAccountId: player.id,
          payload: {
            title: t.tournament.inviteNotificationTitle || 'Convite para Torneio',
            body: `${tournamentName} — ${t.tournament.inviteNotificationBody || 'Foste convidado! Abre a app para ver os detalhes.'}`,
            url: '/?screen=compete',
            tag: `tournament-invite-${tournamentId}`,
          },
          appSource: 'player',
        }),
      }).catch(err => console.error('Push error:', err));
    } catch (err) {
      console.error('Push notification error:', err);
    }

    setSearchResults(prev => prev.filter(p => p.id !== player.id));
    setInviting(null);
    await loadInvites();
  }

  async function handleRemove(inviteId: string) {
    setRemoving(inviteId);
    const { error } = await supabase
      .from('tournament_invites')
      .delete()
      .eq('id', inviteId);

    if (error) {
      console.error('Error removing invite:', error);
      setRemoving(null);
      return;
    }

    setRemoving(null);
    await loadInvites();
  }

  const statusIcon = (status: string) => {
    switch (status) {
      case 'accepted': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'declined': return <XCircle className="w-4 h-4 text-red-500" />;
      default: return <Clock className="w-4 h-4 text-amber-500" />;
    }
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case 'accepted': return t.tournament.inviteAccepted || 'Aceite';
      case 'declined': return t.tournament.inviteDeclined || 'Recusado';
      default: return t.tournament.invitePending || 'Pendente';
    }
  };

  const stats = {
    total: invites.length,
    accepted: invites.filter(i => i.status === 'accepted').length,
    pending: invites.filter(i => i.status === 'pending').length,
    declined: invites.filter(i => i.status === 'declined').length,
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className="fixed inset-0 bg-black/50" onClick={onClose} />

        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {t.tournament.manageInvites || 'Gerir Convites'}
              </h2>
              <p className="text-sm text-gray-500 mt-0.5">{tournamentName}</p>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-3 p-4 bg-gray-50 border-b border-gray-200">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900">{stats.total}</p>
              <p className="text-xs text-gray-500">{t.tournament.invitesTotal || 'Total'}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-green-600">{stats.accepted}</p>
              <p className="text-xs text-gray-500">{t.tournament.inviteAccepted || 'Aceites'}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-amber-600">{stats.pending}</p>
              <p className="text-xs text-gray-500">{t.tournament.invitePending || 'Pendentes'}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-red-600">{stats.declined}</p>
              <p className="text-xs text-gray-500">{t.tournament.inviteDeclined || 'Recusados'}</p>
            </div>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-gray-200">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder={t.tournament.searchPlayersToInvite || 'Pesquisar jogadores para convidar...'}
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 animate-spin" />}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-2 border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                {searchResults.map(player => (
                  <div key={player.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      {player.avatar_url ? (
                        <img src={player.avatar_url} className="w-8 h-8 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                          <Users className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{player.name}</p>
                        <div className="flex items-center gap-2">
                          {player.player_category && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                              {player.player_category}
                            </span>
                          )}
                          {player.level && (
                            <span className="text-xs text-gray-500">Nível {player.level.toFixed(1)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleInvite(player)}
                      disabled={inviting === player.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {inviting === player.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="w-3.5 h-3.5" />
                      )}
                      {t.tournament.invite || 'Convidar'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invited list */}
          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
              </div>
            ) : invites.length === 0 ? (
              <div className="text-center py-12">
                <Mail className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">
                  {t.tournament.noInvitesYet || 'Nenhum convite enviado. Pesquise jogadores acima para convidar.'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {invites.map(invite => (
                  <div
                    key={invite.id}
                    className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border border-gray-100"
                  >
                    <div className="flex items-center gap-3">
                      {invite.player_avatar ? (
                        <img src={invite.player_avatar} className="w-9 h-9 rounded-full object-cover" alt="" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center">
                          <Users className="w-4 h-4 text-gray-400" />
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">{invite.player_name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {invite.player_category && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                              {invite.player_category}
                            </span>
                          )}
                          <div className="flex items-center gap-1">
                            {statusIcon(invite.status)}
                            <span className="text-xs text-gray-500">{statusLabel(invite.status)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemove(invite.id)}
                      disabled={removing === invite.id}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title={t.tournament.removeInvite || 'Remover convite'}
                    >
                      {removing === invite.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
