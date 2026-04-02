import { useState, useEffect } from 'react';
import { supabase, TournamentCategory, CategoryScheduleEntry } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { X, Plus, Trash2, Edit2, Calendar, Clock } from 'lucide-react';

type ManageCategoriesModalProps = {
  tournamentId: string;
  onClose: () => void;
  onCategoriesUpdated: () => void;
};

export default function ManageCategoriesModal({ tournamentId, onClose, onCategoriesUpdated }: ManageCategoriesModalProps) {
  const { t } = useI18n();
  const [categories, setCategories] = useState<TournamentCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingCategory, setEditingCategory] = useState<TournamentCategory | null>(null);
  const [clubCourts, setClubCourts] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [tournamentDates, setTournamentDates] = useState<{ start_date: string; end_date: string }>({ start_date: '', end_date: '' });
  const [newCategory, setNewCategory] = useState({
    name: '',
    format: 'single_elimination' as 'single_elimination' | 'groups_knockout' | 'round_robin' | 'round_robin_teams' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs' | 'crossed_playoffs_teams' | 'mixed_gender' | 'mixed_american',
    number_of_groups: 0,
    max_teams: 16,
    knockout_stage: 'quarterfinals' as 'round_of_16' | 'quarterfinals' | 'semifinals' | 'final',
    qualified_per_group: 2,
    court_names: [] as string[],
    category_schedule: [] as CategoryScheduleEntry[],
    match_duration_minutes: null as number | null,
    accepted_levels: [] as string[],
    min_level: null as number | null,
    max_level: null as number | null
  });

  const ALL_PLAYER_LEVELS = ['M6', 'M5', 'M4', 'M3', 'M2', 'M1', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1'];

  const [tournamentRoundRobinType, setTournamentRoundRobinType] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
    fetchClubCourts();
    fetchTournamentType();
  }, [tournamentId]);

  const fetchTournamentType = async () => {
    const { data } = await supabase
      .from('tournaments')
      .select('round_robin_type, start_date, end_date')
      .eq('id', tournamentId)
      .single();
    if (data) {
      setTournamentRoundRobinType((data as any).round_robin_type);
      setTournamentDates({
        start_date: (data as any).start_date || '',
        end_date: (data as any).end_date || ''
      });
    }
  };

  // Helper to get all dates between start and end
  const getTournamentDateRange = (): string[] => {
    if (!tournamentDates.start_date || !tournamentDates.end_date) return [];
    const dates: string[] = [];
    const start = new Date(tournamentDates.start_date);
    const end = new Date(tournamentDates.end_date);
    const current = new Date(start);
    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  };

  const formatDateLabel = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    return `${dayNames[date.getDay()]} ${day}/${month}`;
  };

  const fetchClubCourts = async () => {
    // Get tournament to find user_id
    const { data: tournament } = await supabase
      .from('tournaments')
      .select('user_id')
      .eq('id', tournamentId)
      .single();

    if (!tournament?.user_id) return;

    const { data, error } = await supabase
      .from('club_courts')
      .select('id, name, type')
      .eq('user_id', tournament.user_id)
      .eq('is_active', true)
      .order('sort_order')
      .order('name');

    if (error) {
      console.error('Error fetching courts:', error);
      return;
    }

    if (data) {
      setClubCourts(data);
    }
  };

  const loadCategories = async () => {
    const { data, error } = await supabase
      .from('tournament_categories')
      .select('*')
      .eq('tournament_id', tournamentId)
      .order('name');

    if (error) {
      console.error('Error loading categories:', error);
      return;
    }

    setCategories(data || []);
  };

  const handleAddCategory = async () => {
    if (!newCategory.name.trim()) {
      alert('Please enter a category name');
      return;
    }

    setLoading(true);

    try {
      const dbFormat = newCategory.format === 'round_robin_teams' ? 'round_robin' : newCategory.format;
      const isGroupsFormat = ['groups_knockout', 'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender', 'mixed_american'].includes(dbFormat);
      const { error } = await supabase
        .from('tournament_categories')
        .insert({
          tournament_id: tournamentId,
          name: newCategory.name,
          format: dbFormat,
          number_of_groups: isGroupsFormat ? newCategory.number_of_groups : 0,
          max_teams: newCategory.max_teams,
          knockout_stage: isGroupsFormat ? newCategory.knockout_stage : null,
          qualified_per_group: isGroupsFormat ? newCategory.qualified_per_group : null,
          court_names: newCategory.court_names.length > 0 ? newCategory.court_names : null,
          category_schedule: newCategory.category_schedule.length > 0 ? newCategory.category_schedule : null,
          match_duration_minutes: newCategory.match_duration_minutes || null,
          accepted_levels: newCategory.accepted_levels.length > 0 ? newCategory.accepted_levels : null,
          min_level: newCategory.min_level,
          max_level: newCategory.max_level
        });

      if (error) throw error;

      const { data: existingCats } = await supabase.from('tournament_categories').select('id').eq('tournament_id', tournamentId);
      if (!existingCats || existingCats.length <= 1) {
        const tournamentFormat = dbFormat === 'round_robin' ? 'round_robin' : dbFormat;
        await supabase.from('tournaments').update({
          format: tournamentFormat,
          round_robin_type: newCategory.format === 'round_robin_teams' ? 'teams' : newCategory.format === 'round_robin_individual' ? 'individual' : null,
        }).eq('id', tournamentId);
      }

      setNewCategory({
        name: '',
        format: 'single_elimination',
        number_of_groups: 0,
        max_teams: 16,
        knockout_stage: 'quarterfinals',
        qualified_per_group: 2,
        court_names: [],
        category_schedule: [],
        match_duration_minutes: null,
        accepted_levels: [],
        min_level: null,
        max_level: null
      });

      await loadCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error adding category:', error);
      alert('Failed to add category');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory) return;

    setLoading(true);

    try {
      const dbFormat = editingCategory.format === 'round_robin_teams' ? 'round_robin' : editingCategory.format;
      const isGroupsFormat = ['groups_knockout', 'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender', 'mixed_american'].includes(dbFormat);
      const { error } = await supabase
        .from('tournament_categories')
        .update({
          name: editingCategory.name,
          format: dbFormat,
          number_of_groups: isGroupsFormat ? editingCategory.number_of_groups : 0,
          max_teams: editingCategory.max_teams,
          knockout_stage: isGroupsFormat ? (editingCategory.knockout_stage || 'quarterfinals') : null,
          qualified_per_group: isGroupsFormat ? (editingCategory.qualified_per_group || 2) : null,
          court_names: editingCategory.court_names && editingCategory.court_names.length > 0 ? editingCategory.court_names : null,
          category_schedule: editingCategory.category_schedule && editingCategory.category_schedule.length > 0 ? editingCategory.category_schedule : null,
          match_duration_minutes: editingCategory.match_duration_minutes || null,
          accepted_levels: editingCategory.accepted_levels && editingCategory.accepted_levels.length > 0 ? editingCategory.accepted_levels : null,
          min_level: editingCategory.min_level ?? null,
          max_level: editingCategory.max_level ?? null
        })
        .eq('id', editingCategory.id);

      if (error) throw error;

      const { data: existingCats } = await supabase.from('tournament_categories').select('id').eq('tournament_id', tournamentId);
      if (!existingCats || existingCats.length <= 1) {
        const tournamentFormat = dbFormat === 'round_robin' ? 'round_robin' : dbFormat;
        await supabase.from('tournaments').update({
          format: tournamentFormat,
          round_robin_type: editingCategory.format === 'round_robin_teams' ? 'teams' : editingCategory.format === 'round_robin_individual' ? 'individual' : null,
        }).eq('id', tournamentId);
      }

      setEditingCategory(null);
      await loadCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error updating category:', error);
      alert('Failed to update category');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm('Are you sure you want to delete this category? Teams and matches in this category will be unassigned.')) {
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('tournament_categories')
        .delete()
        .eq('id', categoryId);

      if (error) throw error;

      await loadCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error deleting category:', error);
      alert('Failed to delete category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">{t.category.manage}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              Categories allow you to organize teams into different divisions (e.g., M1, M2, F1, F2). Each category can have its own format.
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">{t.category.add}</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t.category.name}
                </label>
                <input
                  type="text"
                  value={newCategory.name}
                  onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })}
                  placeholder="e.g., M1, F1, Open"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t.category.format}
                </label>
                <select
                  value={newCategory.format}
                  onChange={(e) => setNewCategory({
                    ...newCategory,
                    format: e.target.value as any
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <optgroup label="Individual">
                    <option value="individual_groups_knockout">{t.format.individual_groups_knockout}</option>
                    <option value="round_robin">{(t.format as any).round_robin_individual || 'Americano Individual'}</option>
                    <option value="mixed_american">{t.format.mixed_american}</option>
                  </optgroup>
                  <optgroup label="Equipas">
                    <option value="round_robin_teams">{(t.format as any).round_robin_teams || 'Americano Equipas'}</option>
                    <option value="groups_knockout">{t.format.groups_knockout}</option>
                    <option value="single_elimination">{t.format.single_elimination}</option>
                    <option value="super_teams">{t.format.super_teams}</option>
                  </optgroup>
                  <optgroup label="Especial">
                    <option value="crossed_playoffs">{t.format.crossed_playoffs}</option>
                    <option value="crossed_playoffs_teams">{t.format.crossed_playoffs_teams || 'Playoffs Cruzados (Equipas)'}</option>
                    <option value="mixed_gender">{t.format.mixed_gender}</option>
                  </optgroup>
                </select>
              </div>

                          {(['groups_knockout', 'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender', 'mixed_american'].includes(newCategory.format)) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t.category.groups}
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="10"
                      value={newCategory.number_of_groups}
                      onChange={(e) => setNewCategory({ ...newCategory, number_of_groups: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t.category.qualifiedPerGroup || 'Qualified per Group'}
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="4"
                      value={newCategory.qualified_per_group}
                      onChange={(e) => setNewCategory({ ...newCategory, qualified_per_group: parseInt(e.target.value) || 2 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t.category.knockoutStage || 'Knockout Stage'}
                    </label>
                    <select
                      value={newCategory.knockout_stage}
                      onChange={(e) => setNewCategory({ ...newCategory, knockout_stage: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="round_of_16">{t.knockout?.round_of_16 || 'Round of 16'}</option>
                      <option value="quarterfinals">{t.knockout?.quarterfinals || 'Quarterfinals'}</option>
                      <option value="semifinals">{t.knockout?.semifinals || 'Semifinals'}</option>
                      <option value="final">{t.knockout?.final || 'Final'}</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t.category.maxTeams}
                </label>
                <input
                  type="number"
                  min="2"
                  max="64"
                  value={newCategory.max_teams}
                  onChange={(e) => setNewCategory({ ...newCategory, max_teams: parseInt(e.target.value) || 16 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Níveis aceites ({newCategory.accepted_levels.length > 0 ? newCategory.accepted_levels.join(', ') : 'todos'})
              </label>
              <div className="border border-gray-300 rounded-lg p-3 bg-gray-50">
                <div className="text-xs text-gray-600 mb-2">
                  Se nenhum nível for selecionado, qualquer jogador pode inscrever-se
                </div>
                <div className="flex flex-wrap gap-2">
                  {ALL_PLAYER_LEVELS.map((level) => {
                    const isSelected = newCategory.accepted_levels.includes(level);
                    return (
                      <label
                        key={level}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer text-sm font-medium transition-colors ${
                          isSelected ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setNewCategory(prev => ({
                              ...prev,
                              accepted_levels: isSelected
                                ? prev.accepted_levels.filter(l => l !== level)
                                : [...prev.accepted_levels, level]
                            }));
                          }}
                          className="sr-only"
                        />
                        {level}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Intervalo de nível (ranking numérico 0.5 – 7.0)
              </label>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Mínimo</label>
                  <input
                    type="number"
                    min="0.5"
                    max="7.0"
                    step="0.1"
                    value={newCategory.min_level ?? ''}
                    onChange={(e) => setNewCategory({ ...newCategory, min_level: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="Ex: 2.0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
                <span className="text-gray-400 mt-5">–</span>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Máximo</label>
                  <input
                    type="number"
                    min="0.5"
                    max="7.0"
                    step="0.1"
                    value={newCategory.max_level ?? ''}
                    onChange={(e) => setNewCategory({ ...newCategory, max_level: e.target.value ? parseFloat(e.target.value) : null })}
                    placeholder="Ex: 4.5"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">Se vazio, sem restrição de nível numérico</p>
            </div>

            {clubCourts.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Campos para esta Categoria ({newCategory.court_names.length > 0 ? newCategory.court_names.length : 'todos'} selecionado{newCategory.court_names.length !== 1 ? 's' : ''})
                </label>
                <div className="border border-gray-300 rounded-lg p-3 space-y-2 bg-gray-50">
                  <div className="text-xs text-gray-600 mb-2">
                    Se nenhum campo for selecionado, todos os campos do torneio serão usados
                  </div>
                  {clubCourts.map((court) => {
                    const isSelected = newCategory.court_names.includes(court.name);
                    return (
                      <label
                        key={court.id}
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {
                            setNewCategory(prev => ({
                              ...prev,
                              court_names: isSelected
                                ? prev.court_names.filter(n => n !== court.name)
                                : [...prev.court_names, court.name]
                            }));
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">{court.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Schedule por Categoria */}
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <Calendar className="w-4 h-4" />
                Horário da Categoria
              </label>
              <div className="border border-gray-300 rounded-lg p-3 bg-gray-50 space-y-3">
                <div className="text-xs text-gray-600">
                  Defina os dias e horários em que esta categoria joga. Se não definir, usa o horário geral do torneio.
                </div>

                {/* Duração do jogo por categoria */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Duração do jogo (min) — opcional, sobrepõe o valor do torneio
                  </label>
                  <input
                    type="number"
                    min="10"
                    max="180"
                    step="5"
                    value={newCategory.match_duration_minutes || ''}
                    onChange={(e) => setNewCategory({ ...newCategory, match_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                    placeholder="Ex: 30, 60, 90"
                    className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {/* Lista de slots de schedule */}
                {newCategory.category_schedule.map((entry, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-200">
                    <div className="flex-1">
                      <select
                        value={entry.date}
                        onChange={(e) => {
                          const updated = [...newCategory.category_schedule];
                          updated[idx] = { ...updated[idx], date: e.target.value };
                          setNewCategory({ ...newCategory, category_schedule: updated });
                        }}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="">Selecionar dia...</option>
                        {getTournamentDateRange().map(d => (
                          <option key={d} value={d}>{formatDateLabel(d)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <input
                        type="time"
                        value={entry.start_time}
                        onChange={(e) => {
                          const updated = [...newCategory.category_schedule];
                          updated[idx] = { ...updated[idx], start_time: e.target.value };
                          setNewCategory({ ...newCategory, category_schedule: updated });
                        }}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <span className="text-gray-400 text-sm">–</span>
                      <input
                        type="time"
                        value={entry.end_time}
                        onChange={(e) => {
                          const updated = [...newCategory.category_schedule];
                          updated[idx] = { ...updated[idx], end_time: e.target.value };
                          setNewCategory({ ...newCategory, category_schedule: updated });
                        }}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = newCategory.category_schedule.filter((_, i) => i !== idx);
                        setNewCategory({ ...newCategory, category_schedule: updated });
                      }}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    const defaultDate = getTournamentDateRange()[0] || '';
                    setNewCategory({
                      ...newCategory,
                      category_schedule: [
                        ...newCategory.category_schedule,
                        { date: defaultDate, start_time: '09:00', end_time: '13:00' }
                      ]
                    });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Adicionar Dia/Horário
                </button>
              </div>
            </div>

            <button
              onClick={handleAddCategory}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {t.category.add}
            </button>
          </div>

          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900">{t.tournament.categories}</h3>

            {categories.length === 0 ? (
              <p className="text-gray-500 text-sm">{t.category.noCategories}</p>
            ) : (
              <div className="space-y-2">
                {categories.map((category) => (
                  <div key={category.id}>
                    {editingCategory?.id === category.id ? (
                      <div className="p-4 border-2 border-blue-500 rounded-lg space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {t.category.name}
                            </label>
                            <input
                              type="text"
                              value={editingCategory.name}
                              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {t.category.format}
                            </label>
                            <select
                              value={editingCategory.format}
                              onChange={(e) => setEditingCategory({
                                ...editingCategory,
                                format: e.target.value as any
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <optgroup label="Individual">
                                <option value="individual_groups_knockout">{t.format.individual_groups_knockout}</option>
                                <option value="round_robin">{(t.format as any).round_robin_individual || 'Americano Individual'}</option>
                                <option value="mixed_american">{t.format.mixed_american}</option>
                              </optgroup>
                              <optgroup label="Equipas">
                                <option value="round_robin_teams">{(t.format as any).round_robin_teams || 'Americano Equipas'}</option>
                                <option value="groups_knockout">{t.format.groups_knockout}</option>
                                <option value="single_elimination">{t.format.single_elimination}</option>
                                <option value="super_teams">{t.format.super_teams}</option>
                              </optgroup>
                              <optgroup label="Especial">
                                <option value="crossed_playoffs">{t.format.crossed_playoffs}</option>
                                <option value="crossed_playoffs_teams">{t.format.crossed_playoffs_teams || 'Playoffs Cruzados (Equipas)'}</option>
                                <option value="mixed_gender">{t.format.mixed_gender}</option>
                              </optgroup>
                            </select>
                          </div>

                          {(['groups_knockout', 'individual_groups_knockout', 'super_teams', 'crossed_playoffs', 'crossed_playoffs_teams', 'mixed_gender', 'mixed_american'].includes(editingCategory.format)) && (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {t.category.groups}
                                </label>
                                <input
                                  type="number"
                                  min="2"
                                  max="10"
                                  value={editingCategory.number_of_groups}
                                  onChange={(e) => setEditingCategory({ ...editingCategory, number_of_groups: parseInt(e.target.value) || 0 })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {t.category.qualifiedPerGroup || 'Qualified per Group'}
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  max="4"
                                  value={editingCategory.qualified_per_group || 2}
                                  onChange={(e) => setEditingCategory({ ...editingCategory, qualified_per_group: parseInt(e.target.value) || 2 })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                              </div>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {t.category.knockoutStage || 'Knockout Stage'}
                                </label>
                                <select
                                  value={editingCategory.knockout_stage || 'quarterfinals'}
                                  onChange={(e) => setEditingCategory({ ...editingCategory, knockout_stage: e.target.value as any })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="round_of_16">{t.knockout?.round_of_16 || 'Round of 16'}</option>
                                  <option value="quarterfinals">{t.knockout?.quarterfinals || 'Quarterfinals'}</option>
                                  <option value="semifinals">{t.knockout?.semifinals || 'Semifinals'}</option>
                                  <option value="final">{t.knockout?.final || 'Final'}</option>
                                </select>
                              </div>
                            </>
                          )}

                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              {t.category.maxTeams}
                            </label>
                            <input
                              type="number"
                              min="2"
                              max="64"
                              value={editingCategory.max_teams}
                              onChange={(e) => setEditingCategory({ ...editingCategory, max_teams: parseInt(e.target.value) || 16 })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>

                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Níveis aceites ({editingCategory.accepted_levels && editingCategory.accepted_levels.length > 0 ? editingCategory.accepted_levels.join(', ') : 'todos'})
                          </label>
                          <div className="border border-gray-300 rounded-lg p-3 bg-gray-50">
                            <div className="text-xs text-gray-600 mb-2">
                              Se nenhum nível for selecionado, qualquer jogador pode inscrever-se
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {ALL_PLAYER_LEVELS.map((level) => {
                                const isSelected = editingCategory.accepted_levels?.includes(level) || false;
                                return (
                                  <label
                                    key={level}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer text-sm font-medium transition-colors ${
                                      isSelected ? 'bg-blue-100 text-blue-700 border border-blue-300' : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setEditingCategory(prev => {
                                          if (!prev) return prev;
                                          const current = prev.accepted_levels || [];
                                          return {
                                            ...prev,
                                            accepted_levels: isSelected
                                              ? current.filter(l => l !== level)
                                              : [...current, level]
                                          };
                                        });
                                      }}
                                      className="sr-only"
                                    />
                                    {level}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Intervalo de nível (ranking numérico 0.5 – 7.0)
                          </label>
                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <label className="block text-xs text-gray-500 mb-1">Mínimo</label>
                              <input
                                type="number"
                                min="0.5"
                                max="7.0"
                                step="0.1"
                                value={editingCategory.min_level ?? ''}
                                onChange={(e) => setEditingCategory({ ...editingCategory, min_level: e.target.value ? parseFloat(e.target.value) : null })}
                                placeholder="Ex: 2.0"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                              />
                            </div>
                            <span className="text-gray-400 mt-5">–</span>
                            <div className="flex-1">
                              <label className="block text-xs text-gray-500 mb-1">Máximo</label>
                              <input
                                type="number"
                                min="0.5"
                                max="7.0"
                                step="0.1"
                                value={editingCategory.max_level ?? ''}
                                onChange={(e) => setEditingCategory({ ...editingCategory, max_level: e.target.value ? parseFloat(e.target.value) : null })}
                                placeholder="Ex: 4.5"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                              />
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">Se vazio, sem restrição de nível numérico</p>
                        </div>

                        {clubCourts.length > 0 && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Campos para esta Categoria ({editingCategory.court_names && editingCategory.court_names.length > 0 ? editingCategory.court_names.length : 'todos'} selecionado{editingCategory.court_names && editingCategory.court_names.length !== 1 ? 's' : ''})
                            </label>
                            <div className="border border-gray-300 rounded-lg p-3 space-y-2 bg-gray-50">
                              <div className="text-xs text-gray-600 mb-2">
                                Se nenhum campo for selecionado, todos os campos do torneio serão usados
                              </div>
                              {clubCourts.map((court) => {
                                const isSelected = editingCategory.court_names?.includes(court.name) || false;
                                return (
                                  <label
                                    key={court.id}
                                    className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                                      isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-white'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => {
                                        setEditingCategory(prev => {
                                          if (!prev) return prev;
                                          const currentNames = prev.court_names || [];
                                          return {
                                            ...prev,
                                            court_names: isSelected
                                              ? currentNames.filter(n => n !== court.name)
                                              : [...currentNames, court.name]
                                          };
                                        });
                                      }}
                                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-gray-700 font-medium">{court.name}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Schedule por Categoria (edição) */}
                        <div>
                          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                            <Calendar className="w-4 h-4" />
                            Horário da Categoria
                          </label>
                          <div className="border border-gray-300 rounded-lg p-3 bg-gray-50 space-y-3">
                            <div className="text-xs text-gray-600">
                              Defina os dias e horários em que esta categoria joga.
                            </div>

                            {/* Duração do jogo por categoria */}
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Duração do jogo (min) — opcional
                              </label>
                              <input
                                type="number"
                                min="10"
                                max="180"
                                step="5"
                                value={editingCategory.match_duration_minutes || ''}
                                onChange={(e) => setEditingCategory({ ...editingCategory, match_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                                placeholder="Ex: 30, 60, 90"
                                className="w-32 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                            </div>

                            {(editingCategory.category_schedule || []).map((entry, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded border border-gray-200">
                                <div className="flex-1">
                                  <select
                                    value={entry.date}
                                    onChange={(e) => {
                                      const updated = [...(editingCategory.category_schedule || [])];
                                      updated[idx] = { ...updated[idx], date: e.target.value };
                                      setEditingCategory({ ...editingCategory, category_schedule: updated });
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  >
                                    <option value="">Selecionar dia...</option>
                                    {getTournamentDateRange().map(d => (
                                      <option key={d} value={d}>{formatDateLabel(d)}</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-gray-400" />
                                  <input
                                    type="time"
                                    value={entry.start_time}
                                    onChange={(e) => {
                                      const updated = [...(editingCategory.category_schedule || [])];
                                      updated[idx] = { ...updated[idx], start_time: e.target.value };
                                      setEditingCategory({ ...editingCategory, category_schedule: updated });
                                    }}
                                    className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  />
                                  <span className="text-gray-400 text-sm">–</span>
                                  <input
                                    type="time"
                                    value={entry.end_time}
                                    onChange={(e) => {
                                      const updated = [...(editingCategory.category_schedule || [])];
                                      updated[idx] = { ...updated[idx], end_time: e.target.value };
                                      setEditingCategory({ ...editingCategory, category_schedule: updated });
                                    }}
                                    className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updated = (editingCategory.category_schedule || []).filter((_, i) => i !== idx);
                                    setEditingCategory({ ...editingCategory, category_schedule: updated });
                                  }}
                                  className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}

                            <button
                              type="button"
                              onClick={() => {
                                const defaultDate = getTournamentDateRange()[0] || '';
                                setEditingCategory({
                                  ...editingCategory,
                                  category_schedule: [
                                    ...(editingCategory.category_schedule || []),
                                    { date: defaultDate, start_time: '09:00', end_time: '13:00' }
                                  ]
                                });
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors font-medium"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Adicionar Dia/Horário
                            </button>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={handleUpdateCategory}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingCategory(null)}
                            disabled={loading}
                            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                        <div>
                          <div className="font-semibold text-gray-900">{category.name}</div>
                          <div className="text-sm text-gray-600">
                            {category.format === 'round_robin'
                              ? (tournamentRoundRobinType === 'teams'
                                ? ((t.format as any).round_robin_teams || 'Americano Equipas')
                                : ((t.format as any).round_robin_individual || 'Americano Individual'))
                              : ((t.format as any)[category.format] || category.format)}
                            {category.number_of_groups > 0 && ` (${category.number_of_groups} ${t.category.groups.toLowerCase()})`}
                            {category.knockout_stage && (
                              <> • {category.knockout_stage === 'round_of_16' ? 'R16' : category.knockout_stage === 'quarterfinals' ? 'QF' : category.knockout_stage === 'semifinals' ? 'SF' : 'F'}</>
                            )}
                            {' • '}
                            Max {category.max_teams} {['round_robin', 'individual_groups_knockout', 'mixed_american', 'crossed_playoffs', 'mixed_gender'].includes(category.format) ? 'players' : 'teams'}
                            {category.court_names && category.court_names.length > 0 && (
                              <> • {category.court_names.length} campo{category.court_names.length !== 1 ? 's' : ''}</>
                            )}
                            {category.match_duration_minutes && (
                              <> • {category.match_duration_minutes}min</>
                            )}
                            {category.accepted_levels && category.accepted_levels.length > 0 && (
                              <> • Níveis: {category.accepted_levels.join(', ')}</>
                            )}
                            {(category.min_level != null || category.max_level != null) && (
                              <> • Rating: {category.min_level ?? '0.5'}–{category.max_level ?? '7.0'}</>
                            )}
                          </div>
                          {category.category_schedule && category.category_schedule.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mt-1">
                              {category.category_schedule.map((entry, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded-full font-medium">
                                  <Calendar className="w-3 h-3" />
                                  {formatDateLabel(entry.date)} {entry.start_time}–{entry.end_time}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const catCopy = { ...category };
                              // Map round_robin to round_robin_teams for display if tournament is teams type
                              if (catCopy.format === 'round_robin' && tournamentRoundRobinType === 'teams') {
                                (catCopy as any).format = 'round_robin_teams';
                              }
                              setEditingCategory(catCopy as any);
                            }}
                            disabled={loading}
                            className="text-blue-600 hover:text-blue-700 transition-colors disabled:opacity-50"
                          >
                            <Edit2 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => handleDeleteCategory(category.id)}
                            disabled={loading}
                            className="text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    )}
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
