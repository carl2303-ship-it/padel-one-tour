import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { X } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { useI18n } from '../lib/i18nContext';

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
}

interface CreateLeagueModalProps {
  league?: League | null;
  onClose: () => void;
}

const defaultScoringSystem: Record<string, number> = {
  '1': 25,
  '2': 20,
  '3': 16,
  '4': 13,
  '5': 12,
  '6': 11,
  '7': 10,
  '8': 9,
  '9': 8,
  '10': 7,
  '11': 6,
  '12': 5,
  '13': 4,
  '14': 3,
  '15': 2,
  '16': 1,
};

export default function CreateLeagueModal({ league, onClose }: CreateLeagueModalProps) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [initialized, setInitialized] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed'>('active');
  const [allowPublicView, setAllowPublicView] = useState(false);
  const [scoringSystem, setScoringSystem] = useState<Record<string, number>>(defaultScoringSystem);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryInput, setCategoryInput] = useState('');
  const [categoryScoringSystemsState, setCategoryScoringSystemsState] = useState<Record<string, Record<string, number>>>({});
  const [selectedScoringCategory, setSelectedScoringCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (league) {
      setName(league.name);
      setDescription(league.description || '');
      setStartDate(league.start_date);
      setEndDate(league.end_date || '');
      setStatus(league.status);
      setAllowPublicView(league.allow_public_view);
      setScoringSystem(league.scoring_system);
      setCategories(league.categories || []);
      setCategoryScoringSystemsState(league.category_scoring_systems || {});
      if (league.categories && league.categories.length > 0) {
        setSelectedScoringCategory(league.categories[0]);
      }
    }
    setInitialized(true);
  }, [league]);

  useEffect(() => {
    if (!initialized) return;

    if (categories.length > 0 && !selectedScoringCategory) {
      setSelectedScoringCategory(categories[0]);
    }
    setCategoryScoringSystemsState(prev => {
      const newCategorySystems = { ...prev };
      let changed = false;
      categories.forEach(cat => {
        if (!newCategorySystems[cat]) {
          newCategorySystems[cat] = { ...defaultScoringSystem };
          changed = true;
        }
      });
      Object.keys(newCategorySystems).forEach(cat => {
        if (!categories.includes(cat)) {
          delete newCategorySystems[cat];
          changed = true;
        }
      });
      return changed ? newCategorySystems : prev;
    });
  }, [categories, selectedScoringCategory, initialized]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const leagueData = {
      name,
      description,
      start_date: startDate,
      end_date: endDate || null,
      status,
      allow_public_view: allowPublicView,
      scoring_system: scoringSystem,
      categories: categories.length > 0 ? categories : [],
      category_scoring_systems: categories.length > 0 ? categoryScoringSystemsState : {},
      user_id: user?.id,
    };

    if (league) {
      const { error } = await supabase
        .from('leagues')
        .update(leagueData)
        .eq('id', league.id);

      if (error) {
        console.error('Error updating league:', error);
        alert(t.league.updateError);
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from('leagues')
        .insert([leagueData]);

      if (error) {
        console.error('Error creating league:', error);
        alert(t.league.createError);
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    onClose();
  };

  const updateScoring = (position: string, points: number) => {
    setScoringSystem({ ...scoringSystem, [position]: points });
  };

  const addPosition = () => {
    const nextPosition = (Object.keys(scoringSystem).length + 1).toString();
    setScoringSystem({ ...scoringSystem, [nextPosition]: 20 });
  };

  const removePosition = (position: string) => {
    const newScoring = { ...scoringSystem };
    delete newScoring[position];
    setScoringSystem(newScoring);
  };

  const addCategory = () => {
    const trimmed = categoryInput.trim().toUpperCase();
    if (trimmed && !categories.includes(trimmed)) {
      setCategories([...categories, trimmed]);
      setCategoryInput('');
    }
  };

  const removeCategory = (cat: string) => {
    setCategories(categories.filter(c => c !== cat));
    if (selectedScoringCategory === cat) {
      const remaining = categories.filter(c => c !== cat);
      setSelectedScoringCategory(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const handleCategoryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCategory();
    }
  };

  const updateCategoryScoring = (category: string, position: string, points: number) => {
    setCategoryScoringSystemsState(prev => ({
      ...prev,
      [category]: {
        ...(prev[category] || {}),
        [position]: points
      }
    }));
  };

  const addCategoryPosition = (category: string) => {
    const currentSystem = categoryScoringSystemsState[category] || {};
    const nextPosition = (Object.keys(currentSystem).length + 1).toString();
    setCategoryScoringSystemsState(prev => ({
      ...prev,
      [category]: {
        ...currentSystem,
        [nextPosition]: 1
      }
    }));
  };

  const removeCategoryPosition = (category: string, position: string) => {
    setCategoryScoringSystemsState(prev => {
      const newSystem = { ...(prev[category] || {}) };
      delete newSystem[position];
      return {
        ...prev,
        [category]: newSystem
      };
    });
  };

  const currentCategoryScoring = selectedScoringCategory
    ? (categoryScoringSystemsState[selectedScoringCategory] || defaultScoringSystem)
    : {};

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
          <h2 className="text-2xl font-bold">
            {league ? t.league.edit : t.league.create}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.league.name} *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.league.description_field}
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.league.startDate} *
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.league.endDate}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.league.status}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'draft' | 'active' | 'completed')}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="draft">{t.league.statusDraft}</option>
              <option value="active">{t.league.statusActive}</option>
              <option value="completed">{t.league.statusCompleted}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.league.categories || 'Categorias (opcional)'}
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Torneios de categorias mais fortes dao mais pontos. Ex: M3 da mais pontos que M4.
            </p>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                onKeyDown={handleCategoryKeyDown}
                placeholder="Ex: M3"
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={addCategory}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                +
              </button>
            </div>
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {categories.map(cat => (
                  <span
                    key={cat}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                  >
                    {cat}
                    <button
                      type="button"
                      onClick={() => removeCategory(cat)}
                      className="hover:text-blue-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="allowPublicView"
              checked={allowPublicView}
              onChange={(e) => setAllowPublicView(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <label htmlFor="allowPublicView" className="ml-2 text-sm text-gray-700">
              {t.league.allowPublicView}
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              {t.league.scoringSystem}
            </label>

            {categories.length === 0 ? (
              <>
                <div className="space-y-2 mb-3">
                  {Object.entries(scoringSystem)
                    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                    .map(([position, points]) => (
                      <div key={position} className="flex items-center gap-3">
                        <span className="text-sm font-medium w-20">{position}º {t.league.position}</span>
                        <input
                          type="number"
                          value={points}
                          onChange={(e) => updateScoring(position, parseInt(e.target.value) || 0)}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          min="0"
                        />
                        <button
                          type="button"
                          onClick={() => removePosition(position)}
                          className="text-red-600 hover:text-red-700 px-3 py-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                </div>
                <button
                  type="button"
                  onClick={addPosition}
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  + {t.league.addPosition}
                </button>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">
                  Defina pontos diferentes por categoria. Categorias mais fortes devem dar mais pontos.
                </p>
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex border-b border-gray-200 bg-gray-50">
                    {categories.map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedScoringCategory(cat)}
                        className={`px-4 py-2 text-sm font-medium transition-colors ${
                          selectedScoringCategory === cat
                            ? 'bg-blue-600 text-white'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                  {selectedScoringCategory && (
                    <div className="p-4">
                      <div className="space-y-2 mb-3">
                        {Object.entries(currentCategoryScoring)
                          .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
                          .map(([position, points]) => (
                            <div key={position} className="flex items-center gap-3">
                              <span className="text-sm font-medium w-20">{position}º {t.league.position}</span>
                              <input
                                type="number"
                                value={points}
                                onChange={(e) => updateCategoryScoring(selectedScoringCategory, position, parseInt(e.target.value) || 0)}
                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                min="0"
                              />
                              <button
                                type="button"
                                onClick={() => removeCategoryPosition(selectedScoringCategory, position)}
                                className="text-red-600 hover:text-red-700 px-3 py-2"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => addCategoryPosition(selectedScoringCategory)}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        + {t.league.addPosition}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {t.button.cancel}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
            >
              {saving ? t.button.saving : league ? t.league.updateLeague : t.league.createLeague}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
