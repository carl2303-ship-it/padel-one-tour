import { useState, useEffect } from 'react';
import { supabase, Tournament } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { X, Upload } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import RichTextEditor from './RichTextEditor';
import { compressImage, formatFileSize } from '../lib/imageCompressor';

type EditTournamentModalProps = {
  tournament: Tournament;
  onClose: () => void;
  onSuccess: () => void;
};

export default function EditTournamentModal({ tournament, onClose, onSuccess }: EditTournamentModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: tournament.name,
    description: tournament.description || '',
    image_url: (tournament as any).image_url || '',
    start_date: tournament.start_date,
    end_date: tournament.end_date,
    start_time: (tournament as any).start_time || '09:00',
    end_time: (tournament as any).end_time || '12:00',
    daily_start_time: (tournament as any).daily_start_time || '09:00',
    daily_end_time: (tournament as any).daily_end_time || '21:00',
    format: tournament.format,
    round_robin_type: (tournament as any).round_robin_type || 'teams',
    max_teams: tournament.max_teams,
    number_of_courts: (tournament as any).number_of_courts || 1,
    status: tournament.status,
    match_duration_minutes: (tournament as any).match_duration_minutes || 15,
    number_of_groups: (tournament as any).number_of_groups || 4,
    knockout_stage: (tournament as any).knockout_stage || 'quarterfinals' as 'final' | 'round_of_16' | 'quarterfinals' | 'semifinals',
    registration_fee: (tournament as any).registration_fee || 0,
    allow_public_registration: (tournament as any).allow_public_registration || false,
    registration_deadline: (tournament as any).registration_deadline ? new Date((tournament as any).registration_deadline).toISOString().split('T')[0] : '',
    registration_redirect_url: (tournament as any).registration_redirect_url || '',
    mixed_knockout: (tournament as any).mixed_knockout || false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>(tournament.image_url || '');
  const [uploading, setUploading] = useState(false);
  const [dailySchedules, setDailySchedules] = useState<Array<{ date: string; start_time: string; end_time: string }>>(((tournament as any).daily_schedules || []) as Array<{ date: string; start_time: string; end_time: string }>);
  const [leagues, setLeagues] = useState<Array<{ id: string; name: string; categories?: string[] }>>([]);
  const [selectedLeagues, setSelectedLeagues] = useState<Map<string, { category: string | null; groupFilter: string | null }>>(new Map());
  const [clubs, setClubs] = useState<Array<{ id: string; name: string; owner_id: string }>>([]);
  const [selectedClubId, setSelectedClubId] = useState<string>((tournament as any).club_id || '');
  const [clubCourts, setClubCourts] = useState<Array<{ id: string; name: string; type: string; is_active: boolean }>>([]);
  const [selectedCourtNames, setSelectedCourtNames] = useState<string[]>((tournament as any).court_names || []);

  useEffect(() => {
    if (user) {
      fetchLeagues();
      fetchTournamentLeagues();
      fetchClubs();
    }
  }, [user]);

  useEffect(() => {
    if (selectedClubId) {
      fetchClubCourts(selectedClubId);
    } else {
      setClubCourts([]);
    }
  }, [selectedClubId]);

  const fetchClubs = async () => {
    const { data } = await supabase
      .from('clubs')
      .select('id, name, owner_id')
      .eq('is_active', true)
      .order('name');

    if (data) {
      setClubs(data);
    }
  };

  const fetchClubCourts = async (clubId: string) => {
    const club = clubs.find(c => c.id === clubId);
    if (!club) {
      const { data: clubData } = await supabase
        .from('clubs')
        .select('owner_id')
        .eq('id', clubId)
        .maybeSingle();

      if (clubData) {
        const { data: courts } = await supabase
          .from('club_courts')
          .select('id, name, type, is_active')
          .eq('user_id', clubData.owner_id)
          .eq('is_active', true)
          .order('sort_order');

        if (courts) {
          setClubCourts(courts);
        }
      }
    } else {
      const { data: courts } = await supabase
        .from('club_courts')
        .select('id, name, type, is_active')
        .eq('user_id', club.owner_id)
        .eq('is_active', true)
        .order('sort_order');

      if (courts) {
        setClubCourts(courts);
      }
    }
  };

  const fetchLeagues = async () => {
    const { data } = await supabase
      .from('leagues')
      .select('id, name, categories')
      .eq('user_id', user?.id)
      .eq('status', 'active')
      .order('name');

    if (data) {
      setLeagues(data);
    }
  };

  const fetchTournamentLeagues = async () => {
    const { data } = await supabase
      .from('tournament_leagues')
      .select('league_id, league_category, group_filter')
      .eq('tournament_id', tournament.id);

    if (data) {
      const newMap = new Map<string, { category: string | null; groupFilter: string | null }>();
      data.forEach(d => {
        newMap.set(d.league_id, { category: d.league_category, groupFilter: d.group_filter });
      });
      setSelectedLeagues(newMap);
    }
  };

  const toggleLeague = (leagueId: string) => {
    setSelectedLeagues(prev => {
      const newMap = new Map(prev);
      if (newMap.has(leagueId)) {
        newMap.delete(leagueId);
      } else {
        newMap.set(leagueId, { category: null, groupFilter: null });
      }
      return newMap;
    });
  };

  const setLeagueCategory = (leagueId: string, category: string | null) => {
    setSelectedLeagues(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(leagueId) || { category: null, groupFilter: null };
      newMap.set(leagueId, { ...existing, category });
      return newMap;
    });
  };

  const setLeagueGroupFilter = (leagueId: string, groupFilter: string | null) => {
    setSelectedLeagues(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(leagueId) || { category: null, groupFilter: null };
      newMap.set(leagueId, { ...existing, groupFilter });
      return newMap;
    });
  };

  const toggleCourtSelection = (courtName: string) => {
    setSelectedCourtNames(prev => {
      if (prev.includes(courtName)) {
        return prev.filter(n => n !== courtName);
      } else {
        return [...prev, courtName];
      }
    });
  };

  const selectAllCourts = () => {
    setSelectedCourtNames(clubCourts.map(c => c.name));
  };

  const clearCourtSelection = () => {
    setSelectedCourtNames([]);
  };

  const generateDailySchedules = (startDate: string, endDate: string) => {
    if (!startDate || !endDate) return;

    const start = new Date(startDate);
    const end = new Date(endDate);
    const schedules: Array<{ date: string; start_time: string; end_time: string }> = [];

    const current = new Date(start);
    while (current <= end) {
      schedules.push({
        date: current.toISOString().split('T')[0],
        start_time: formData.daily_start_time,
        end_time: formData.daily_end_time,
      });
      current.setDate(current.getDate() + 1);
    }

    setDailySchedules(schedules);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = 2 * 1024 * 1024;

    if (file.size > 10 * 1024 * 1024) {
      setError('Imagem muito grande (max 10MB antes de compressao)');
      return;
    }

    try {
      setError('');
      const compressed = await compressImage(file);

      if (compressed.size > maxSize) {
        setError(`Imagem ainda muito grande apos compressao: ${formatFileSize(compressed.size)}. Tente uma imagem mais pequena.`);
        return;
      }

      setImageFile(compressed);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(compressed);
    } catch {
      setError('Erro ao processar imagem');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      setError('End date must be after start date');
      setLoading(false);
      return;
    }

    let imageUrl = formData.image_url;

    if (imageFile) {
      setUploading(true);
      const fileExt = imageFile.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('tournament-images')
        .upload(filePath, imageFile);

      if (uploadError) {
        setError(`Upload error: ${uploadError.message}`);
        setLoading(false);
        setUploading(false);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('tournament-images')
        .getPublicUrl(filePath);

      imageUrl = publicUrl;
      setUploading(false);
    }

    const { error: submitError } = await supabase
      .from('tournaments')
      .update({
        name: formData.name,
        description: formData.description,
        image_url: imageUrl,
        start_date: formData.start_date,
        end_date: formData.end_date,
        start_time: formData.start_time,
        end_time: formData.end_time,
        daily_start_time: formData.daily_start_time,
        daily_end_time: formData.daily_end_time,
        daily_schedules: dailySchedules.length > 0 ? dailySchedules : null,
        format: formData.format,
        number_of_courts: selectedCourtNames.length > 0 ? selectedCourtNames.length : formData.number_of_courts,
        status: formData.status,
        match_duration_minutes: formData.match_duration_minutes,
        number_of_groups: formData.number_of_groups,
        knockout_stage: formData.knockout_stage,
        registration_fee: formData.registration_fee,
        allow_public_registration: formData.allow_public_registration,
        registration_deadline: formData.registration_deadline ? new Date(formData.registration_deadline).toISOString() : null,
        registration_redirect_url: formData.registration_redirect_url || null,
        mixed_knockout: formData.mixed_knockout,
        club_id: selectedClubId || null,
        court_names: selectedCourtNames.length > 0 ? selectedCourtNames : null,
      })
      .eq('id', tournament.id);

    if (submitError) {
      setError(submitError.message);
      setLoading(false);
      return;
    }

    await supabase
      .from('tournament_leagues')
      .delete()
      .eq('tournament_id', tournament.id);

    if (selectedLeagues.size > 0) {
      const leagueAssociations = Array.from(selectedLeagues.entries()).map(([leagueId, config]) => ({
        tournament_id: tournament.id,
        league_id: leagueId,
        league_category: config.category,
        group_filter: config.groupFilter
      }));

      const { error: leagueError } = await supabase
        .from('tournament_leagues')
        .insert(leagueAssociations);

      if (leagueError) {
        console.error('Error associating leagues:', leagueError);
      }
    }

    setLoading(false);
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{t.tournament.edit}</h2>
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
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.tournament.name} *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.tournament.description}</label>
            <RichTextEditor
              value={formData.description}
              onChange={(value) => setFormData({ ...formData, description: value })}
              placeholder="Adicione detalhes sobre o torneio..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Ligas (opcional)</label>
            {leagues.length > 0 ? (
              <div className="border border-gray-300 rounded-lg p-3 space-y-2 max-h-80 overflow-y-auto bg-gray-50">
                {leagues.map((league) => {
                  const isSelected = selectedLeagues.has(league.id);
                  const hasCategories = league.categories && league.categories.length > 0;
                  const leagueConfig = selectedLeagues.get(league.id);
                  const selectedCategory = leagueConfig?.category;
                  const selectedGroupFilter = leagueConfig?.groupFilter;

                  return (
                    <div key={league.id} className={`p-2 rounded transition-colors ${isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-white'}`}>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleLeague(league.id)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">{league.name}</span>
                        {hasCategories && (
                          <span className="text-xs text-gray-500">({league.categories?.join(', ')})</span>
                        )}
                      </label>

                      {isSelected && (
                        <div className="mt-2 ml-6 space-y-2">
                          {hasCategories && (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Categoria para pontuacao:
                              </label>
                              <select
                                value={selectedCategory || ''}
                                onChange={(e) => setLeagueCategory(league.id, e.target.value || null)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value="">Selecionar categoria...</option>
                                {league.categories?.map(cat => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            </div>
                          )}

                          {formData.mixed_knockout && (
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">
                                Filtrar por grupo (Torneio Misto):
                              </label>
                              <select
                                value={selectedGroupFilter || ''}
                                onChange={(e) => setLeagueGroupFilter(league.id, e.target.value || null)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              >
                                <option value="">Todos os jogadores</option>
                                <option value="A">Apenas Grupo A</option>
                                <option value="B">Apenas Grupo B</option>
                              </select>
                              <p className="text-xs text-gray-500 mt-1">
                                Ex: Liga feminina = Grupo A, Liga masculina = Grupo B
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">Nenhuma liga ativa disponivel</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Associe este torneio a uma ou mais ligas para contribuir para as classificacoes
            </p>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Clube e Campos</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Clube</label>
                <select
                  value={selectedClubId}
                  onChange={(e) => {
                    setSelectedClubId(e.target.value);
                    setSelectedCourtNames([]);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Sem clube associado</option>
                  {clubs.map((club) => (
                    <option key={club.id} value={club.id}>{club.name}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Associe este torneio a um clube para selecionar campos especificos
                </p>
              </div>

              {selectedClubId && clubCourts.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">Campos do Torneio</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllCourts}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Selecionar todos
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        type="button"
                        onClick={clearCourtSelection}
                        className="text-xs text-gray-600 hover:text-gray-800"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>
                  <div className="border border-gray-300 rounded-lg p-3 space-y-2 bg-gray-50">
                    {clubCourts.map((court) => (
                      <label
                        key={court.id}
                        className={`flex items-center gap-3 p-2 rounded cursor-pointer transition-colors ${
                          selectedCourtNames.includes(court.name)
                            ? 'bg-blue-50 border border-blue-200'
                            : 'hover:bg-white'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCourtNames.includes(court.name)}
                          onChange={() => toggleCourtSelection(court.name)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">{court.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          court.type === 'indoor'
                            ? 'bg-blue-100 text-blue-700'
                            : court.type === 'outdoor'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {court.type}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {selectedCourtNames.length} campo(s) selecionado(s) - Estes campos serao usados no agendamento de jogos e reservas
                  </p>
                </div>
              )}

              {selectedClubId && clubCourts.length === 0 && (
                <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
                  Este clube nao tem campos configurados. Configure os campos na gestao do clube.
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.tournament.imageUrl}</label>

            {imagePreview ? (
              <div className="relative">
                <img src={imagePreview} alt="Preview" className="w-full h-48 object-cover rounded-lg" />
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview('');
                    setFormData({ ...formData, image_url: '' });
                  }}
                  className="absolute top-2 right-2 bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer bg-gray-50 hover:bg-gray-100 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-10 h-10 text-gray-400 mb-3" />
                  <p className="mb-2 text-sm text-gray-500">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">PNG, JPG ate 2MB (comprimido automaticamente)</p>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageChange}
                />
              </label>
            )}
            <p className="text-xs text-gray-500 mt-1">{t.tournament.imageUrlHelper}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.tournament.startDate} *
              </label>
              <input
                type="date"
                required
                value={formData.start_date}
                onChange={(e) => {
                  setFormData({ ...formData, start_date: e.target.value });
                  if (e.target.value && formData.end_date) {
                    generateDailySchedules(e.target.value, formData.end_date);
                  }
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t.tournament.endDate} *</label>
              <input
                type="date"
                required
                value={formData.end_date}
                onChange={(e) => {
                  setFormData({ ...formData, end_date: e.target.value });
                  if (formData.start_date && e.target.value) {
                    generateDailySchedules(formData.start_date, e.target.value);
                  }
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.tournament.dailyStartTime} *
              </label>
              <input
                type="time"
                required
                value={formData.daily_start_time}
                onChange={(e) => setFormData({
                  ...formData,
                  daily_start_time: e.target.value,
                  start_time: e.target.value
                })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">{t.tournament.dailyStartTimeHelper}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.tournament.dailyEndTime} *
              </label>
              <input
                type="time"
                required
                value={formData.daily_end_time}
                onChange={(e) => setFormData({
                  ...formData,
                  daily_end_time: e.target.value,
                  end_time: e.target.value
                })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1">{t.tournament.dailyEndTimeHelper}</p>
            </div>
          </div>

          {dailySchedules.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t.tournament.customizeSchedule || 'Customize Daily Schedule'}</h3>
              <p className="text-xs text-gray-600 mb-3">{t.tournament.customizeScheduleHelper || 'Set different hours for each day'}</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {dailySchedules.map((schedule, index) => (
                  <div key={index} className="grid grid-cols-3 gap-2 items-center bg-white p-2 rounded border border-gray-200">
                    <div className="text-sm font-medium text-gray-700">
                      {(() => {
                        const d = new Date(schedule.date + 'T00:00:00');
                        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
                      })()}
                    </div>
                    <input
                      type="time"
                      value={schedule.start_time}
                      onChange={(e) => {
                        const updated = [...dailySchedules];
                        updated[index].start_time = e.target.value;
                        setDailySchedules(updated);
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <input
                      type="time"
                      value={schedule.end_time}
                      onChange={(e) => {
                        const updated = [...dailySchedules];
                        updated[index].end_time = e.target.value;
                        setDailySchedules(updated);
                      }}
                      className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.tournament.format} *
            </label>
            <select
              value={formData.format}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  format: e.target.value as 'single_elimination' | 'round_robin' | 'groups_knockout' | 'individual_groups_knockout',
                })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="single_elimination">{t.format.single_elimination}</option>
              <option value="round_robin">{t.format.round_robin}</option>
              <option value="groups_knockout">{t.format.groups_knockout}</option>
              <option value="individual_groups_knockout">{t.format.individual_groups_knockout}</option>
            </select>
          </div>

          {formData.format === 'round_robin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Round Robin Type *
              </label>
              <select
                value={formData.round_robin_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    round_robin_type: e.target.value as 'teams' | 'individual',
                  })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="teams">Teams (Fixed Pairs)</option>
                <option value="individual">Individual (Rotating Partners)</option>
              </select>
              <p className="text-sm text-gray-500 mt-1">
                {formData.round_robin_type === 'teams'
                  ? 'Teams play all other teams'
                  : 'Players rotate partners each round'}
              </p>
            </div>
          )}

          {formData.format === 'groups_knockout' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-blue-900">{t.tournament.groupStageSettings}</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.tournament.numberOfGroups} *
                  </label>
                  <select
                    value={formData.number_of_groups}
                    onChange={(e) => setFormData({ ...formData, number_of_groups: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value={2}>2 groups</option>
                    <option value={3}>3 groups</option>
                    <option value={4}>4 groups</option>
                    <option value={6}>6 groups</option>
                    <option value={8}>8 groups</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.tournament.knockoutStageLabel} *
                  </label>
                  <select
                    value={formData.knockout_stage}
                    onChange={(e) => setFormData({ ...formData, knockout_stage: e.target.value as 'final' | 'round_of_16' | 'quarterfinals' | 'semifinals' })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="final">Final (2 teams)</option>
                    <option value="semifinals">Semifinals (4 teams)</option>
                    <option value="quarterfinals">Quarterfinals (8 teams)</option>
                    <option value="round_of_16">Round of 16 (16 teams)</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-gray-600 bg-white p-3 rounded border border-gray-200">
                <strong>{t.tournament.knockoutStageLabel}:</strong> {t.tournament.knockoutStageDescription} {formData.knockout_stage === 'final' ? t.tournament.twoTeamFinal : formData.knockout_stage === 'semifinals' ? t.tournament.fourTeamSemifinals : formData.knockout_stage === 'quarterfinals' ? t.tournament.eightTeamQuarterfinals : t.tournament.sixteenTeamRoundOf16}.
                {formData.knockout_stage === 'round_of_16' && ` ${t.tournament.best3rdIncluded}`}
              </div>
            </div>
          )}

          {formData.format === 'individual_groups_knockout' && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
              <h3 className="text-sm font-semibold text-blue-900">{t.tournament.groupStageSettings}</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.tournament.numberOfGroups} *
                  </label>
                  <select
                    value={formData.number_of_groups}
                    onChange={(e) => setFormData({ ...formData, number_of_groups: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value={2}>2 groups</option>
                    <option value={3}>3 groups</option>
                    <option value={4}>4 groups</option>
                    <option value={6}>6 groups</option>
                    <option value={8}>8 groups</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t.tournament.knockoutStageLabel} *
                  </label>
                  <select
                    value={formData.knockout_stage}
                    onChange={(e) => setFormData({ ...formData, knockout_stage: e.target.value as 'final' | 'round_of_16' | 'quarterfinals' | 'semifinals' })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="final">Final (2 teams)</option>
                    <option value="semifinals">Semifinals (4 teams)</option>
                    <option value="quarterfinals">Quarterfinals (8 teams)</option>
                    <option value="round_of_16">Round of 16 (16 teams)</option>
                  </select>
                </div>
              </div>

              <div className="text-xs text-gray-600 bg-white p-3 rounded border border-gray-200">
                <strong>Individual Groups + Knockout:</strong> Players compete individually in groups with rotating partners, then top players advance to knockout rounds.
              </div>

              <div className="border-t border-blue-200 pt-4 mt-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="mixed_knockout"
                    checked={formData.mixed_knockout}
                    onChange={(e) => setFormData({ ...formData, mixed_knockout: e.target.checked })}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <label htmlFor="mixed_knockout" className="text-sm font-medium text-gray-700">
                    Knockout Misto (Americano Misto)
                  </label>
                </div>
                <p className="text-xs text-gray-500 mt-2 ml-7">
                  Quando ativado, a fase knockout combina jogadores de diferentes categorias (ex: 1 Homem + 1 Mulher por equipa).
                  Use isto quando tiver categorias masculina e feminina separadas nos grupos que devem jogar juntas nas finais.
                </p>
                {formData.mixed_knockout && (
                  <div className="mt-3 bg-amber-50 border border-amber-200 rounded p-3">
                    <p className="text-xs text-amber-800">
                      <strong>Importante:</strong> Para funcionar corretamente, certifique-se de que tem igual numero de jogadores qualificados em cada categoria (ex: 2 homens + 2 mulheres para meias-finais).
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.tournament.courts} *
              </label>
              <input
                type="number"
                min={1}
                max={10}
                required
                value={formData.number_of_courts}
                onChange={(e) =>
                  setFormData({ ...formData, number_of_courts: parseInt(e.target.value) })
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Limite de inscricoes
              </label>
              <div className="px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-sm text-gray-600">
                Definido nas categorias
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Use "Gerir Categorias" para alterar limites
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.tournament.matchDuration} *
            </label>
            <select
              required
              value={formData.match_duration_minutes}
              onChange={(e) =>
                setFormData({ ...formData, match_duration_minutes: parseInt(e.target.value) })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              {Array.from({ length: 13 }, (_, i) => i + 8).map((min) => (
                <option key={min} value={min}>{min} minutes</option>
              ))}
              {Array.from({ length: 20 }, (_, i) => 25 + i * 5).map((min) => (
                <option key={min} value={min}>{min} minutes</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {t.tournament.matchDurationHelper}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t.tournament.registrationFee}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={formData.registration_fee}
              onChange={(e) =>
                setFormData({ ...formData, registration_fee: parseFloat(e.target.value) || 0 })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="0.00"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t.tournament.registrationFeeHelper}
            </p>
          </div>

          <div className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">{t.tournament.publicRegistrationSettings}</h3>

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="allow_public_registration"
                  checked={formData.allow_public_registration}
                  onChange={(e) => setFormData({ ...formData, allow_public_registration: e.target.checked })}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                />
                <label htmlFor="allow_public_registration" className="text-sm font-medium text-gray-700">
                  {t.tournament.allowPublicRegistration}
                </label>
              </div>
              <p className="text-xs text-gray-500 -mt-2 ml-7">
                {t.tournament.allowPublicRegistrationHelper}
              </p>

              {formData.allow_public_registration && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t.tournament.registrationDeadline}
                    </label>
                    <input
                      type="date"
                      value={formData.registration_deadline}
                      onChange={(e) => setFormData({ ...formData, registration_deadline: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t.tournament.registrationDeadlineHelper}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t.tournament.redirectUrl}
                    </label>
                    <input
                      type="url"
                      value={formData.registration_redirect_url}
                      onChange={(e) => setFormData({ ...formData, registration_redirect_url: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://chat.whatsapp.com/..."
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {t.tournament.redirectUrlHelper}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.tournament.status} *</label>
            <select
              value={formData.status}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  status: e.target.value as 'draft' | 'active' | 'completed' | 'cancelled',
                })
              }
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="draft">{t.status.draft}</option>
              <option value="active">{t.status.active}</option>
              <option value="completed">{t.status.completed}</option>
              <option value="cancelled">{t.status.cancelled}</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              {t.button.cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t.message.saving : t.button.saveChanges}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
