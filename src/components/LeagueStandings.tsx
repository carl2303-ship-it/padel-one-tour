import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { ArrowLeft, Trophy, TrendingUp, Calendar, RefreshCw, Printer, Tag, ChevronDown, Filter } from 'lucide-react';
import { useI18n } from '../lib/i18nContext';
import { exportLeagueStandingsPDF } from '../lib/pdfExport';

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

interface League {
  id: string;
  name: string;
  description: string;
  start_date: string;
  end_date: string | null;
  status: string;
  scoring_system: Record<string, number>;
  categories?: string[];
  category_scoring_systems?: Record<string, Record<string, number>>;
  user_id: string;
}

interface Standing {
  id: string;
  entity_type: 'player';
  entity_name: string;
  total_points: number;
  tournaments_played: number;
  best_position: number | null;
  player_category?: PlayerCategory;
}

interface Tournament {
  id: string;
  name: string;
  start_date: string;
  status: string;
}

interface LeagueStandingsProps {
  league: League;
  onBack: () => void;
}

function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function getCategoryBadgeColor(category: PlayerCategory): string {
  if (!category) return 'bg-gray-100 text-gray-500';
  const level = parseInt(category.charAt(1));
  if (level >= 5) return 'bg-green-100 text-green-700';
  if (level >= 3) return 'bg-blue-100 text-blue-700';
  return 'bg-amber-100 text-amber-700';
}

export default function LeagueStandings({ league, onBack }: LeagueStandingsProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [standings, setStandings] = useState<Standing[]>([]);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [selectedScoringTab, setSelectedScoringTab] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedPlayerCategory, setSelectedPlayerCategory] = useState<string>('all');
  const [playerCategories, setPlayerCategories] = useState<Map<string, PlayerCategory>>(new Map());

  const hasCategories = league.categories && league.categories.length > 0;
  const isOwner = user?.id === league.user_id;

  const handleExportPDF = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportLeagueStandingsPDF(league, filteredStandings, selectedPlayerCategory);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Erro ao exportar PDF');
    } finally {
      setExporting(false);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [standingsResult, tournamentLeaguesResult] = await Promise.all([
      supabase
        .from('league_standings')
        .select('*')
        .eq('league_id', league.id)
        .eq('entity_type', 'player')
        .order('total_points', { ascending: false })
        .order('best_position', { ascending: true }),
      supabase
        .from('tournament_leagues')
        .select('tournament_id')
        .eq('league_id', league.id)
    ]);

    let standingsData = standingsResult.data || [];

    if (standingsData.length > 0) {
      // Get player_account_ids from standings
      const playerAccountIds = standingsData
        .map(s => s.player_account_id)
        .filter((id): id is string => id !== null && id !== undefined);

      // Fetch player categories from player_accounts (the source of truth)
      const categoryMapByAccountId = new Map<string, PlayerCategory>();
      const categoryMapByName = new Map<string, PlayerCategory>();
      
      if (playerAccountIds.length > 0) {
        const { data: playerAccounts } = await supabase
          .from('player_accounts')
          .select('id, name, player_category')
          .in('id', playerAccountIds);

        if (playerAccounts) {
          playerAccounts.forEach(pa => {
            if (pa.player_category) {
              categoryMapByAccountId.set(pa.id, pa.player_category as PlayerCategory);
              // Also add by name for fallback matching
              categoryMapByName.set(normalizeName(pa.name), pa.player_category as PlayerCategory);
            }
          });
        }
      }

      // Also check organizer_players as fallback for players without player_account_id
      const standingsWithoutAccount = standingsData.filter(s => !s.player_account_id);
      if (standingsWithoutAccount.length > 0) {
        const { data: organizerPlayers } = await supabase
          .from('organizer_players')
          .select('name, player_category')
          .eq('organizer_id', league.user_id);

        if (organizerPlayers) {
          organizerPlayers.forEach(op => {
            if (op.player_category) {
              const normalizedName = normalizeName(op.name);
              // Only add if not already in map (player_accounts takes precedence)
              if (!categoryMapByName.has(normalizedName)) {
                categoryMapByName.set(normalizedName, op.player_category as PlayerCategory);
              }
            }
          });
        }
      }

      // Combine both maps for the state (used for filtering)
      const combinedCategoryMap = new Map<string, PlayerCategory>();
      categoryMapByAccountId.forEach((cat, id) => combinedCategoryMap.set(id, cat));
      categoryMapByName.forEach((cat, name) => combinedCategoryMap.set(name, cat));
      setPlayerCategories(combinedCategoryMap);

      // Map categories to standings
      standingsData = standingsData.map(s => {
        let category: PlayerCategory = null;
        
        // First try: use player_account_id to get category (most reliable)
        if (s.player_account_id && categoryMapByAccountId.has(s.player_account_id)) {
          category = categoryMapByAccountId.get(s.player_account_id)!;
        } else {
          // Fallback: try to match by name (for players without player_account_id)
          const normalizedName = normalizeName(s.entity_name);
          category = categoryMapByName.get(normalizedName) || null;
        }
        
        return {
          ...s,
          player_category: category
        };
      });
    }

    setStandings(standingsData);

    if (tournamentLeaguesResult.data && tournamentLeaguesResult.data.length > 0) {
      const tournamentIds = tournamentLeaguesResult.data.map(tl => tl.tournament_id);
      const { data: tournamentsData } = await supabase
        .from('tournaments')
        .select('id, name, start_date, status')
        .in('id', tournamentIds)
        .order('start_date', { ascending: false });

      if (tournamentsData) {
        setTournaments(tournamentsData);
      }
    } else {
      setTournaments([]);
    }

    setLoading(false);
  }, [league.id, league.user_id]);

  useEffect(() => {
    fetchData();
    if (hasCategories && league.categories && league.categories.length > 0) {
      setSelectedScoringTab(league.categories[0]);
    }
  }, [league.id, fetchData, hasCategories, league.categories]);

  const handleRecalculate = async () => {
    if (recalculating) return;

    setRecalculating(true);
    try {
      const { error } = await supabase.rpc('recalculate_league_standings_for_league', {
        league_uuid: league.id
      });

      if (error) throw error;

      await fetchData();
      alert('League standings recalculated successfully!');
    } catch (error) {
      console.error('Error recalculating standings:', error);
      alert('Error recalculating standings. Please try again.');
    } finally {
      setRecalculating(false);
    }
  };

  const getMedalEmoji = (position: number) => {
    switch (position) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '';
    }
  };

  const filteredStandings = standings.filter(standing => {
    if (selectedPlayerCategory === 'all') return true;
    if (selectedPlayerCategory === 'none') return !standing.player_category;
    return standing.player_category === selectedPlayerCategory;
  });

  const categoryCounts = standings.reduce((acc, s) => {
    const cat = s.player_category || 'none';
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const hasAnyPlayerCategories = standings.some(s => s.player_category);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-xl">{t.league.loadingStandings}</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-5 h-5" />
        {t.league.backToLeagues}
      </button>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2 mb-2">
          <Trophy className="w-8 h-8 text-yellow-500" />
          {league.name}
        </h1>
        {league.description && (
          <p className="text-gray-600">{league.description}</p>
        )}
        <div className="flex items-center gap-2 text-sm text-gray-500 mt-2">
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
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    {t.league.standings.title}
                  </h2>
                  <p className="text-sm text-gray-600 mt-2">
                    <span className="font-semibold text-green-600">{t.league.standings.subtitle}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleExportPDF}
                    disabled={exporting || filteredStandings.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Printer className={`w-4 h-4 ${exporting ? 'animate-pulse' : ''}`} />
                    {exporting ? 'A exportar...' : 'Imprimir PDF'}
                  </button>
                  {isOwner && (
                    <button
                      onClick={handleRecalculate}
                      disabled={recalculating}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RefreshCw className={`w-4 h-4 ${recalculating ? 'animate-spin' : ''}`} />
                      {recalculating ? 'Recalculating...' : 'Recalculate'}
                    </button>
                  )}
                </div>
              </div>

              {hasAnyPlayerCategories && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Filter className="w-4 h-4" />
                    <span>Filtrar por categoria:</span>
                  </div>
                  <div className="relative">
                    <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <select
                      value={selectedPlayerCategory}
                      onChange={(e) => setSelectedPlayerCategory(e.target.value)}
                      className="pl-9 pr-8 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none bg-white text-sm"
                    >
                      <option value="all">Todas ({standings.length})</option>
                      <option value="none">Sem categoria ({categoryCounts['none'] || 0})</option>
                      <optgroup label="Masculino">
                        {PLAYER_CATEGORIES.filter(c => c.gender === 'M').map(c => (
                          <option key={c.value} value={c.value}>
                            {c.label} ({categoryCounts[c.value] || 0})
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Feminino">
                        {PLAYER_CATEGORIES.filter(c => c.gender === 'F').map(c => (
                          <option key={c.value} value={c.value}>
                            {c.label} ({categoryCounts[c.value] || 0})
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  </div>
                  {selectedPlayerCategory !== 'all' && (
                    <span className="text-sm text-gray-500">
                      ({filteredStandings.length} jogadores)
                    </span>
                  )}
                </div>
              )}
            </div>

            {filteredStandings.length === 0 ? (
              <div className="p-12 text-center">
                <Trophy className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">
                  {selectedPlayerCategory !== 'all'
                    ? 'Nenhum jogador encontrado nesta categoria'
                    : t.league.standings.noStandings
                  }
                </p>
                {selectedPlayerCategory === 'all' && (
                  <>
                    <p className="text-sm text-gray-500 mt-2">
                      {t.league.standings.noStandingsDescription}
                    </p>
                    <p className="text-sm font-medium text-blue-600 mt-3">
                      {t.league.standings.finalizeTip}
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t.league.standings.position}
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t.league.standings.player}
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t.league.standings.points}
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t.league.standings.tournaments}
                      </th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t.league.standings.bestPosition}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredStandings.map((standing, index) => (
                      <tr key={standing.id} className={index < 3 ? 'bg-yellow-50' : ''}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-gray-900">
                              {index + 1}
                            </span>
                            <span className="text-2xl">{getMedalEmoji(index + 1)}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              {standing.entity_name}
                            </span>
                            {standing.player_category && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${getCategoryBadgeColor(standing.player_category)}`}>
                                {standing.player_category}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="text-lg font-bold text-blue-600">
                            {standing.total_points}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="text-sm text-gray-900">
                            {standing.tournaments_played}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          {standing.best_position ? (
                            <span className="text-sm font-medium text-gray-900">
                              {standing.best_position}º
                            </span>
                          ) : (
                            <span className="text-sm text-gray-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {t.league.tournaments.title} ({tournaments.length})
            </h3>
            <div className="space-y-3">
              {tournaments.length === 0 ? (
                <p className="text-sm text-gray-500">{t.league.tournaments.none}</p>
              ) : (
                <>
                  {tournaments.map((tournament) => (
                    <div key={tournament.id} className={`border-l-4 ${tournament.status === 'completed' ? 'border-green-500' : 'border-yellow-500'} pl-3`}>
                      <div className="text-sm font-medium text-gray-900">
                        {tournament.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {(() => {
                          const d = new Date(tournament.start_date);
                          return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
                        })()}
                        <span className={`ml-2 px-2 py-0.5 rounded-full ${
                          tournament.status === 'completed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {tournament.status === 'completed' ? t.league.tournaments.completed : t.league.tournaments.inProgress}
                        </span>
                      </div>
                      {tournament.status !== 'completed' && (
                        <div className="text-xs text-orange-600 mt-1">
                          {t.league.tournaments.finalizeTip}
                        </div>
                      )}
                    </div>
                  ))}
                  {tournaments.filter(t => t.status !== 'completed').length > 0 && (
                    <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                      <p className="text-xs text-blue-800">
                        {t.league.tournaments.pendingTip}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {t.league.scoringSystem}
            </h3>
            {hasCategories && league.categories && league.category_scoring_systems ? (
              <>
                <div className="flex gap-1 mb-4 border-b">
                  {league.categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedScoringTab(cat)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${
                        selectedScoringTab === cat
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {selectedScoringTab && league.category_scoring_systems[selectedScoringTab] &&
                    Object.entries(league.category_scoring_systems[selectedScoringTab])
                      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                      .slice(0, 8)
                      .map(([position, points]) => (
                        <div key={position} className="flex justify-between items-center text-sm">
                          <span className="text-gray-600">{position}º {t.league.position}</span>
                          <span className="font-bold text-gray-900">{points} {t.league.standings.pts}</span>
                        </div>
                      ))}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                {Object.entries(league.scoring_system)
                  .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                  .slice(0, 8)
                  .map(([position, points]) => (
                    <div key={position} className="flex justify-between items-center text-sm">
                      <span className="text-gray-600">{position}º {t.league.position}</span>
                      <span className="font-bold text-gray-900">{points} {t.league.standings.pts}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {hasAnyPlayerCategories && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Tag className="w-5 h-5" />
                Categorias de Jogadores
              </h3>
              <div className="space-y-2">
                {PLAYER_CATEGORIES.map(cat => {
                  const count = categoryCounts[cat.value] || 0;
                  if (count === 0) return null;
                  return (
                    <button
                      key={cat.value}
                      onClick={() => setSelectedPlayerCategory(cat.value)}
                      className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                        selectedPlayerCategory === cat.value
                          ? 'bg-blue-100 text-blue-800'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      <span className={`px-2 py-0.5 rounded font-medium ${getCategoryBadgeColor(cat.value)}`}>
                        {cat.label}
                      </span>
                      <span className="font-semibold">{count} jogadores</span>
                    </button>
                  );
                })}
                {(categoryCounts['none'] || 0) > 0 && (
                  <button
                    onClick={() => setSelectedPlayerCategory('none')}
                    className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedPlayerCategory === 'none'
                        ? 'bg-blue-100 text-blue-800'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <span className="px-2 py-0.5 rounded font-medium bg-gray-100 text-gray-500">
                      Sem categoria
                    </span>
                    <span className="font-semibold">{categoryCounts['none']} jogadores</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
