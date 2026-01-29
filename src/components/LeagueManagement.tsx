import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trophy, Calendar, Edit, Trash2, Eye, ArrowLeft, Filter } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { useI18n } from '../lib/i18nContext';
import CreateLeagueModal from './CreateLeagueModal';
import LeagueStandings from './LeagueStandings';

interface League {
  id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string | null;
  status: 'draft' | 'active' | 'completed';
  scoring_system: Record<string, number>;
  allow_public_view: boolean;
  categories?: string[];
  category_scoring_systems?: Record<string, Record<string, number>>;
  created_at: string;
}

interface LeagueManagementProps {
  onBack: () => void;
}

export default function LeagueManagement({ onBack }: LeagueManagementProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [allLeagues, setAllLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingLeague, setEditingLeague] = useState<League | null>(null);
  const [viewingLeague, setViewingLeague] = useState<League | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);

  useEffect(() => {
    if (user) {
      fetchLeagues();
    }
  }, [user]);

  useEffect(() => {
    applyFilters();
  }, [statusFilter, categoryFilter, allLeagues]);

  const applyFilters = () => {
    let filtered = [...allLeagues];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(l => l.status === statusFilter);
    }

    if (categoryFilter !== 'all') {
      filtered = filtered.filter(l => l.categories?.includes(categoryFilter));
    }

    setLeagues(filtered);
  };

  const fetchLeagues = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('leagues')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching leagues:', error);
    } else {
      const leaguesData = data || [];
      setAllLeagues(leaguesData);

      const allCats = leaguesData.flatMap(l => l.categories || []);
      const uniqueCats = [...new Set(allCats)];
      setAvailableCategories(uniqueCats);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.league.deleteConfirm)) {
      return;
    }

    const { error } = await supabase
      .from('leagues')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting league:', error);
      alert(t.league.deleteError);
    } else {
      fetchLeagues();
    }
  };

  const handleEdit = (league: League) => {
    setEditingLeague(league);
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingLeague(null);
    fetchLeagues();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800';
      case 'completed': return 'bg-gray-100 text-gray-800';
      case 'draft': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active': return t.league.statusActive;
      case 'completed': return t.league.statusCompleted;
      case 'draft': return t.league.statusDraft;
      default: return status;
    }
  };

  if (viewingLeague) {
    return <LeagueStandings league={viewingLeague} onBack={() => setViewingLeague(null)} />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">{t.league.loadingLeagues}</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
        {t.league.backToTournaments}
      </button>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
            <Trophy className="w-8 h-8" />
            {t.league.title}
          </h1>
          <p className="text-gray-600 mt-2">{t.league.description}</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-5 h-5" />
          {t.league.create}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => setStatusFilter('all')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm ${
            statusFilter === 'all'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          {t.nav.all}
        </button>
        <button
          onClick={() => setStatusFilter('active')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm ${
            statusFilter === 'active'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          {t.league.statusActive}
        </button>
        <button
          onClick={() => setStatusFilter('completed')}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm ${
            statusFilter === 'completed'
              ? 'bg-blue-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
          }`}
        >
          {t.league.statusCompleted}
        </button>
        {availableCategories.length > 0 && (
          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none pl-8 pr-8 py-2 rounded-lg text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">{t.tournament.allCategories || 'Todas as categorias'}</option>
              {availableCategories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {leagues.length === 0 && allLeagues.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Trophy className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">{t.league.noLeagues}</h3>
          <p className="text-gray-600 mb-6">{t.league.createFirst}</p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {t.league.createButton}
          </button>
        </div>
      ) : leagues.length === 0 && allLeagues.length > 0 ? (
        <div className="text-center py-12 bg-white rounded-lg shadow">
          <Filter className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Nenhuma liga encontrada</h3>
          <p className="text-gray-600 mb-4">Nao existem ligas com os filtros selecionados.</p>
          <button
            onClick={() => {
              setStatusFilter('all');
              setCategoryFilter('all');
            }}
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            Limpar filtros
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {leagues.map((league) => (
            <div key={league.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-bold text-gray-900">{league.name}</h3>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(league.status)}`}>
                    {getStatusText(league.status)}
                  </span>
                </div>

                {league.description && (
                  <p className="text-gray-600 mb-4 line-clamp-2">{league.description}</p>
                )}

                <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
                  <Calendar className="w-4 h-4" />
                  <span>
                    {(() => {
                      const d = new Date(league.start_date);
                      return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
                    })()}
                    {league.end_date && ` - ${(() => {
                      const d = new Date(league.end_date);
                      return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
                    })()}`}
                  </span>
                </div>

                {league.categories && league.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-4">
                    {league.categories.map(cat => (
                      <span key={cat} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    onClick={() => setViewingLeague(league)}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors text-sm"
                  >
                    <Eye className="w-4 h-4" />
                    {t.league.viewStandings}
                  </button>
                  {league.user_id === user?.id && (
                    <>
                      <button
                        onClick={() => handleEdit(league)}
                        className="flex items-center justify-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(league.id)}
                        className="flex items-center justify-center gap-2 bg-red-100 text-red-700 px-4 py-2 rounded-lg hover:bg-red-200 transition-colors text-sm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateLeagueModal
          league={editingLeague}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
}
