import { useEffect, useState } from 'react';
import { supabase, Tournament } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { Trophy, Calendar, Users, Plus, UserPlus, Copy, Trash2, Contact, Filter } from 'lucide-react';
import OrganizerPlayersModal from './OrganizerPlayersModal';

type TournamentListProps = {
  onSelectTournament: (tournament: Tournament) => void;
  onCreateTournament: () => void;
  onShowRegistration: (tournament: Tournament) => void;
};

export default function TournamentList({ onSelectTournament, onCreateTournament, onShowRegistration }: TournamentListProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [allTournaments, setAllTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const [registrationCounts, setRegistrationCounts] = useState<Record<string, number>>({});
  const [categoryMaxTeams, setCategoryMaxTeams] = useState<Record<string, number>>({});
  const [tournamentCategories, setTournamentCategories] = useState<Record<string, string[]>>({});
  const [showPlayersModal, setShowPlayersModal] = useState(false);

  useEffect(() => {
    fetchTournaments();
  }, [filter, user]);

  useEffect(() => {
    if (categoryFilter === 'all') {
      setTournaments(allTournaments);
    } else {
      const filtered = allTournaments.filter(t =>
        tournamentCategories[t.id]?.includes(categoryFilter)
      );
      setTournaments(filtered);
    }
  }, [categoryFilter, allTournaments, tournamentCategories]);

  const fetchTournaments = async () => {
    if (!user) return;

    setLoading(true);
    let query = supabase
      .from('tournaments')
      .select('*')
      .eq('user_id', user.id)
      .order('start_date', { ascending: false });

    if (filter === 'active') {
      query = query.eq('status', 'active');
    } else if (filter === 'completed') {
      query = query.eq('status', 'completed');
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching tournaments:', error);
    } else {
      const tournamentsData = data || [];
      setAllTournaments(tournamentsData);

      if (tournamentsData.length > 0) {
        const tournamentIds = tournamentsData.map(t => t.id);
        const { data: categoriesData } = await supabase
          .from('tournament_categories')
          .select('tournament_id, name')
          .in('tournament_id', tournamentIds);

        const catMap: Record<string, string[]> = {};
        const allCats: string[] = [];
        categoriesData?.forEach(c => {
          if (!catMap[c.tournament_id]) {
            catMap[c.tournament_id] = [];
          }
          catMap[c.tournament_id].push(c.name);
          if (!allCats.includes(c.name)) {
            allCats.push(c.name);
          }
        });
        setTournamentCategories(catMap);
        setAvailableCategories(allCats.sort());

        fetchRegistrationCounts(tournamentsData);
      }

      if (categoryFilter === 'all') {
        setTournaments(tournamentsData);
      }
    }
    setLoading(false);
  };

  const fetchRegistrationCounts = async (tournamentsList: Tournament[]) => {
    const counts: Record<string, number> = {};
    const maxTeams: Record<string, number> = {};
    const tournamentIds = tournamentsList.map(t => t.id);

    const [teamsResult, playersResult, categoriesResult] = await Promise.all([
      supabase.from('teams').select('tournament_id').in('tournament_id', tournamentIds),
      supabase.from('players').select('tournament_id').in('tournament_id', tournamentIds),
      supabase.from('tournament_categories').select('tournament_id, max_teams, format').in('tournament_id', tournamentIds)
    ]);

    const teamsData = teamsResult.data || [];
    const playersData = playersResult.data || [];
    const categoriesData = categoriesResult.data || [];

    const teamCountMap = new Map<string, number>();
    const playerCountMap = new Map<string, number>();
    teamsData.forEach(t => teamCountMap.set(t.tournament_id, (teamCountMap.get(t.tournament_id) || 0) + 1));
    playersData.forEach(p => playerCountMap.set(p.tournament_id, (playerCountMap.get(p.tournament_id) || 0) + 1));

    tournamentIds.forEach(id => {
      const teamCount = teamCountMap.get(id) || 0;
      const playerCount = playerCountMap.get(id) || 0;
      counts[id] = teamCount > 0 ? teamCount : playerCount;

      const tournamentCats = categoriesData.filter(c => c.tournament_id === id);
      if (tournamentCats.length > 0) {
        maxTeams[id] = tournamentCats.reduce((sum, cat) => sum + (cat.max_teams || 0), 0);
      }
    });

    setRegistrationCounts(counts);
    setCategoryMaxTeams(maxTeams);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'draft':
        return 'bg-yellow-100 text-yellow-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  const handleDeleteTournament = async (e: React.MouseEvent, tournamentId: string, tournamentName: string) => {
    e.stopPropagation();

    if (!confirm(`${t.message.confirmDelete} "${tournamentName}"? This will delete all teams, matches, and categories. This action cannot be undone.`)) {
      return;
    }

    const { error } = await supabase
      .from('tournaments')
      .delete()
      .eq('id', tournamentId);

    if (error) {
      console.error('Error deleting tournament:', error);
      alert('Failed to delete tournament');
    } else {
      fetchTournaments();
    }
  };

  const handleCopyTournament = async (e: React.MouseEvent, tournament: Tournament) => {
    e.stopPropagation();

    const newName = prompt(`Nome do novo torneio:`, `${tournament.name} (Cópia)`);
    if (!newName) return;

    // Buscar categorias do torneio original
    const { data: categories } = await supabase
      .from('tournament_categories')
      .select('name, format, number_of_groups, max_teams')
      .eq('tournament_id', tournament.id);

    // Criar novo torneio (apenas configurações, sem jogadores)
    const { data: newTournament, error } = await supabase
      .from('tournaments')
      .insert({
        name: newName,
        description: tournament.description,
        start_date: tournament.start_date,
        end_date: tournament.end_date,
        status: 'draft',
        max_teams: tournament.max_teams,
        format: tournament.format,
        number_of_courts: tournament.number_of_courts,
        start_time: tournament.start_time,
        end_time: tournament.end_time,
        match_duration_minutes: tournament.match_duration_minutes,
        number_of_groups: tournament.number_of_groups,
        user_id: tournament.user_id,
        round_robin_type: tournament.round_robin_type,
        category: tournament.category,
        teams_per_group: tournament.teams_per_group,
        qualified_per_group: tournament.qualified_per_group,
        daily_start_time: tournament.daily_start_time,
        daily_end_time: tournament.daily_end_time,
        daily_schedules: tournament.daily_schedules,
        qualified_teams_per_group: tournament.qualified_teams_per_group,
        knockout_stage: tournament.knockout_stage,
        allow_public_registration: false,
      })
      .select()
      .single();

    if (error) {
      console.error('Error copying tournament:', error);
      alert('Erro ao copiar torneio');
      return;
    }

    // Copiar categorias (sem jogadores)
    if (categories && categories.length > 0 && newTournament) {
      const categoriesToInsert = categories.map(cat => ({
        tournament_id: newTournament.id,
        name: cat.name,
        format: cat.format,
        number_of_groups: cat.number_of_groups,
        max_teams: cat.max_teams,
      }));

      await supabase
        .from('tournament_categories')
        .insert(categoriesToInsert);
    }

    // NÃO copiar jogadores, equipas ou jogos - torneio fica limpo e pronto a usar
    
    if (newTournament) {
      alert(`Torneio "${newName}" criado com sucesso!\n\nConfigurações copiadas:\n- Formato: ${tournament.format}\n- Categorias: ${categories?.length || 0}\n- Campos: ${tournament.number_of_courts}\n\nAgora pode adicionar os jogadores.`);
      fetchTournaments();
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#007BFF]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 sm:gap-0">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-bold transition-colors whitespace-nowrap shadow-sm ${
              filter === 'all'
                ? 'bg-[#007BFF] text-white shadow-md'
                : 'bg-white text-[#111111] hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {t.nav.all}
          </button>
          <button
            onClick={() => setFilter('active')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-bold transition-colors whitespace-nowrap shadow-sm ${
              filter === 'active'
                ? 'bg-[#007BFF] text-white shadow-md'
                : 'bg-white text-[#111111] hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {t.nav.active}
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-bold transition-colors whitespace-nowrap shadow-sm ${
              filter === 'completed'
                ? 'bg-[#007BFF] text-white shadow-md'
                : 'bg-white text-[#111111] hover:bg-gray-50 border border-gray-200'
            }`}
          >
            {t.nav.completed}
          </button>
          {availableCategories.length > 0 && (
            <div className="relative">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="appearance-none pl-8 pr-8 py-1.5 sm:py-2 rounded-lg text-sm sm:text-base font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 cursor-pointer shadow-sm focus:outline-none focus:ring-2 focus:ring-[#007BFF]/20"
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
        <div className="flex gap-2">
          <button
            onClick={() => setShowPlayersModal(true)}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm sm:text-base font-medium shadow-sm"
            title="Ver todos os jogadores"
          >
            <Contact className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden lg:inline">Jogadores</span>
          </button>
          <button
            onClick={onCreateTournament}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 bg-[#007BFF] text-white rounded-lg hover:bg-[#0069d9] transition-colors text-sm sm:text-base font-bold shadow-md"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="hidden sm:inline">{t.tournament.create}</span>
            <span className="sm:hidden">{t.button.add}</span>
          </button>
        </div>
      </div>

      {tournaments.length === 0 ? (
        <div className="text-center py-8 sm:py-12 bg-white rounded-xl border border-gray-200">
          <Trophy className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-3 sm:mb-4" />
          <h3 className="text-base sm:text-lg font-medium text-gray-900 mb-2">{t.tournament.noTournaments}</h3>
          <p className="text-sm sm:text-base text-gray-500 mb-4 sm:mb-6 px-4">{t.tournament.createFirst}</p>
          <button
            onClick={onCreateTournament}
            className="inline-flex items-center gap-1.5 sm:gap-2 px-4 sm:px-6 py-2 sm:py-3 bg-[#007BFF] text-white rounded-lg hover:bg-[#0069d9] transition-colors text-sm sm:text-base font-bold shadow-md"
          >
            <Plus className="w-4 h-4 sm:w-5 sm:h-5" />
            {t.tournament.create}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tournaments.map((tournament) => (
            <div
              key={tournament.id}
              className="bg-white rounded-lg border border-gray-200 hover:shadow-xl transition-all overflow-hidden"
            >
              {(tournament as any).image_url && (
                <div className="h-48 overflow-hidden">
                  <img
                    src={(tournament as any).image_url}
                    alt={tournament.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <button
                onClick={() => onSelectTournament(tournament)}
                className="w-full p-4 sm:p-6 text-left group"
              >
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="p-2 sm:p-3 bg-[#007BFF]/10 rounded-lg group-hover:bg-[#007BFF]/20 transition-colors">
                    <Trophy className="w-5 h-5 sm:w-6 sm:h-6 text-[#007BFF]" />
                  </div>
                  <span
                    className={`px-2 sm:px-3 py-0.5 sm:py-1 rounded-full text-xs font-medium ${getStatusColor(
                      tournament.status
                    )}`}
                  >
                    {t.status[tournament.status as keyof typeof t.status]}
                  </span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-[#111111] mb-3 sm:mb-4 group-hover:text-[#007BFF] transition-colors">
                  {tournament.name}
                </h3>
                <div className="space-y-1.5 sm:space-y-2">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-500">
                    <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                    <span className="truncate">
                      {formatDate(tournament.start_date)} - {formatDate(tournament.end_date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-gray-500">
                    <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                    <span className="font-semibold text-[#007BFF]">{registrationCounts[tournament.id] || 0}</span>
                    <span>/</span>
                    <span>{categoryMaxTeams[tournament.id] || tournament.max_teams} inscritos</span>
                  </div>
                </div>
              </button>
              <div className="border-t border-gray-200 p-3 sm:p-4 space-y-2">
                <button
                  onClick={() => onShowRegistration(tournament)}
                  className="w-full flex items-center justify-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-1.5 sm:py-2 bg-[#FF9900] text-white rounded-lg hover:bg-[#e68a00] transition-colors text-sm sm:text-base font-bold shadow-md"
                >
                  <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {t.team.add}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={(e) => handleCopyTournament(e, tournament)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#007BFF]/10 text-[#007BFF] rounded-lg hover:bg-[#007BFF]/20 transition-colors text-sm font-bold"
                    title="Copy tournament"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {t.button.copy}
                  </button>
                  <button
                    onClick={(e) => handleDeleteTournament(e, tournament.id, tournament.name)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm font-medium"
                    title="Delete tournament"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t.button.delete}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <OrganizerPlayersModal
        isOpen={showPlayersModal}
        onClose={() => setShowPlayersModal(false)}
      />
    </div>
  );
}
