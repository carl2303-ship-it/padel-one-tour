import { useState, useEffect } from 'react';
import { supabase, TournamentCategory } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { X, Plus, Trash2, Edit2 } from 'lucide-react';

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
  const [newCategory, setNewCategory] = useState({
    name: '',
    format: 'single_elimination' as 'single_elimination' | 'groups_knockout' | 'round_robin' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs' | 'mixed_gender' | 'mixed_american',
    number_of_groups: 0,
    max_teams: 16,
    knockout_stage: 'quarterfinals' as 'round_of_16' | 'quarterfinals' | 'semifinals' | 'final',
    qualified_per_group: 2,
    game_format: '1set' as '1set' | '3sets'
  });

  useEffect(() => {
    loadCategories();
  }, [tournamentId]);

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
      alert(t.category.errorNameRequired);
      return;
    }

    setLoading(true);

    try {
      const isGroupsFormat = newCategory.format === 'groups_knockout' || newCategory.format === 'individual_groups_knockout' || newCategory.format === 'super_teams';
      
      // Tentar inserir com game_format primeiro
      const insertData: any = {
        tournament_id: tournamentId,
        name: newCategory.name,
        format: newCategory.format,
        number_of_groups: isGroupsFormat ? newCategory.number_of_groups : 0,
        max_teams: newCategory.max_teams,
        knockout_stage: isGroupsFormat ? newCategory.knockout_stage : null,
        qualified_per_group: isGroupsFormat ? newCategory.qualified_per_group : null,
        game_format: newCategory.game_format
      };

      let { error } = await supabase
        .from('tournament_categories')
        .insert(insertData);

      // Se falhar por causa de game_format, tentar sem ele
      if (error && error.message.includes('game_format')) {
        console.warn('game_format column not found, inserting without it');
        delete insertData.game_format;
        const retry = await supabase
          .from('tournament_categories')
          .insert(insertData);
        error = retry.error;
      }

      if (error) throw error;

      setNewCategory({
        name: '',
        format: 'single_elimination',
        number_of_groups: 0,
        max_teams: 16,
        knockout_stage: 'quarterfinals',
        qualified_per_group: 2,
        game_format: '1set'
      });

      await loadCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error adding category:', error);
      alert(t.category.errorAddFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory) return;

    setLoading(true);

    try {
      const isGroupsFormat = editingCategory.format === 'groups_knockout' || editingCategory.format === 'individual_groups_knockout' || editingCategory.format === 'super_teams';
      
      const updateData: any = {
        name: editingCategory.name,
        format: editingCategory.format,
        number_of_groups: isGroupsFormat ? editingCategory.number_of_groups : 0,
        max_teams: editingCategory.max_teams,
        knockout_stage: isGroupsFormat ? (editingCategory.knockout_stage || 'quarterfinals') : null,
        qualified_per_group: isGroupsFormat ? (editingCategory.qualified_per_group || 2) : null,
        game_format: editingCategory.game_format || '1set'
      };

      let { error } = await supabase
        .from('tournament_categories')
        .update(updateData)
        .eq('id', editingCategory.id);

      // Se falhar por causa de game_format, tentar sem ele
      if (error && error.message.includes('game_format')) {
        console.warn('game_format column not found, updating without it');
        delete updateData.game_format;
        const retry = await supabase
          .from('tournament_categories')
          .update(updateData)
          .eq('id', editingCategory.id);
        error = retry.error;
      }

      if (error) throw error;

      setEditingCategory(null);
      await loadCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error updating category:', error);
      alert(t.category.errorUpdateFailed);
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
      await supabase.from('players').update({ category_id: null }).eq('category_id', categoryId);
      await supabase.from('teams').update({ category_id: null }).eq('category_id', categoryId);
      await supabase.from('matches').update({ category_id: null }).eq('category_id', categoryId);

      const { error } = await supabase
        .from('tournament_categories')
        .delete()
        .eq('id', categoryId);

      if (error) throw error;

      await loadCategories();
      onCategoriesUpdated();
    } catch (error) {
      console.error('Error deleting category:', error);
      alert(t.category.errorDeleteFailed);
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
              {t.category.description || 'Categories allow you to organize teams into different divisions. Each category can have its own format.'}
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
                    format: e.target.value as 'single_elimination' | 'groups_knockout' | 'round_robin' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs' | 'mixed_gender' | 'mixed_american'
                  })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="single_elimination">{t.format.single_elimination}</option>
                  <option value="groups_knockout">{t.format.groups_knockout}</option>
                  <option value="round_robin">{t.format.round_robin}</option>
                  <option value="individual_groups_knockout">{t.format.individual_groups_knockout}</option>
                  <option value="super_teams">{t.format.super_teams}</option>
                  <option value="crossed_playoffs">Crossed Playoffs</option>
                  <option value="mixed_gender">Mixed Gender</option>
                  <option value="mixed_american">Americano Misto (1H+1M vs 1H+1M)</option>
                </select>
              </div>

              {(newCategory.format === 'groups_knockout' || newCategory.format === 'individual_groups_knockout' || newCategory.format === 'super_teams') && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {t.category.groups}
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="8"
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

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t.category.gameFormat}
                </label>
                <select
                  value={newCategory.game_format}
                  onChange={(e) => setNewCategory({ ...newCategory, game_format: e.target.value as '1set' | '3sets' })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="1set">{t.category.gameFormat1Set}</option>
                  <option value="3sets">{t.category.gameFormat3Sets}</option>
                </select>
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
                                format: e.target.value as 'single_elimination' | 'groups_knockout' | 'round_robin' | 'individual_groups_knockout' | 'super_teams' | 'crossed_playoffs' | 'mixed_gender' | 'mixed_american'
                              })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="single_elimination">{t.format.single_elimination}</option>
                              <option value="groups_knockout">{t.format.groups_knockout}</option>
                              <option value="round_robin">{t.format.round_robin}</option>
                              <option value="individual_groups_knockout">{t.format.individual_groups_knockout}</option>
                              <option value="super_teams">{t.format.super_teams}</option>
                              <option value="crossed_playoffs">Crossed Playoffs</option>
                              <option value="mixed_gender">Mixed Gender</option>
                              <option value="mixed_american">Americano Misto (1H+1M vs 1H+1M)</option>
                            </select>
                          </div>

                          {(editingCategory.format === 'groups_knockout' || editingCategory.format === 'individual_groups_knockout' || editingCategory.format === 'super_teams') && (
                            <>
                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {t.category.groups}
                                </label>
                                <input
                                  type="number"
                                  min="2"
                                  max="8"
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

                              <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                  {t.category.gameFormat}
                                </label>
                                <select
                                  value={editingCategory.game_format || '1set'}
                                  onChange={(e) => setEditingCategory({ ...editingCategory, game_format: e.target.value as '1set' | '3sets' })}
                                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                >
                                  <option value="1set">{t.category.gameFormat1Set}</option>
                                  <option value="3sets">{t.category.gameFormat3Sets}</option>
                                </select>
                              </div>

                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={handleUpdateCategory}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
                          >
                            {t.category.save}
                          </button>
                          <button
                            onClick={() => setEditingCategory(null)}
                            disabled={loading}
                            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
                          >
                            {t.button.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                        <div>
                          <div className="font-semibold text-gray-900">{category.name}</div>
                          <div className="text-sm text-gray-600">
                            {category.format === 'single_elimination' && t.format.single_elimination}
                            {category.format === 'round_robin' && t.format.round_robin}
                            {category.format === 'super_teams' && t.format.super_teams}
                            {category.format === 'crossed_playoffs' && 'Crossed Playoffs'}
                            {category.format === 'mixed_gender' && 'Mixed Gender'}
                            {category.format === 'mixed_american' && 'Americano Misto'}
                            {category.format === 'groups_knockout' && `${t.format.groups_knockout} (${category.number_of_groups} ${t.category.groups.toLowerCase()})`}
                            {category.format === 'individual_groups_knockout' && `${t.format.individual_groups_knockout} (${category.number_of_groups} ${t.category.groups.toLowerCase()})`}
                            {(category.format === 'groups_knockout' || category.format === 'individual_groups_knockout' || category.format === 'super_teams') && category.knockout_stage && (
                              <> • {category.knockout_stage === 'round_of_16' ? 'R16' : category.knockout_stage === 'quarterfinals' ? 'QF' : category.knockout_stage === 'semifinals' ? 'SF' : 'F'}</>
                            )}
                            {' • '}
                            {t.category.maxLabel} {category.max_teams} {category.format === 'round_robin' || category.format === 'individual_groups_knockout' ? t.category.maxPlayers : t.category.maxTeams}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setEditingCategory(category)}
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
