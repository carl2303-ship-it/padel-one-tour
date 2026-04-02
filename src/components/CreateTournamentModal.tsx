import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import { X, Upload } from 'lucide-react';
import TimeInput24h from './TimeInput24h';
import { compressImage, formatFileSize } from '../lib/imageCompressor';

type CreateTournamentModalProps = {
  onClose: () => void;
  onSuccess: () => void;
};

export default function CreateTournamentModal({ onClose, onSuccess }: CreateTournamentModalProps) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    image_url: '',
    start_date: '',
    end_date: '',
    start_time: '09:00',
    end_time: '12:00',
    daily_start_time: '09:00',
    daily_end_time: '21:00',
    match_duration_minutes: 30,
    member_price: 0,
    non_member_price: 0,
    allow_club_payment: false,
    has_dinner_option: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [dailySchedules, setDailySchedules] = useState<Array<{ date: string; start_time: string; end_time: string }>>([]);
  const [clubs, setClubs] = useState<Array<{ id: string; name: string; owner_id: string }>>([]);
  const [selectedClubId, setSelectedClubId] = useState<string>('');
  const [clubCourts, setClubCourts] = useState<Array<{ id: string; name: string; type: string; is_active: boolean }>>([]);
  const [selectedCourtNames, setSelectedCourtNames] = useState<string[]>([]);

  useEffect(() => {
    fetchClubs();
  }, []);

  useEffect(() => {
    if (selectedClubId) {
      fetchClubCourts(selectedClubId);
    } else {
      setClubCourts([]);
      setSelectedCourtNames([]);
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
      setError(t.tournament.errorImageTooBig);
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
      setError(t.tournament.errorProcessingImage);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (new Date(formData.end_date) < new Date(formData.start_date)) {
      setError(t.tournament.errorEndDateBeforeStart);
      setLoading(false);
      return;
    }

    if (!selectedClubId) {
      setError(t.tournament.errorSelectClub);
      setLoading(false);
      return;
    }

    if (selectedCourtNames.length === 0) {
      setError(t.tournament.errorSelectCourts);
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

    const { data: tournamentData, error: submitError } = await supabase.from('tournaments').insert([
      {
        name: formData.name,
        description: formData.description,
        image_url: imageUrl,
        start_date: formData.start_date,
        end_date: formData.end_date,
        start_time: formData.daily_start_time,
        end_time: formData.daily_end_time,
        daily_start_time: formData.daily_start_time,
        daily_end_time: formData.daily_end_time,
        format: 'groups_knockout',
        max_teams: 999,
        number_of_courts: selectedCourtNames.length,
        match_duration_minutes: formData.match_duration_minutes,
        member_price: formData.member_price || null,
        non_member_price: formData.non_member_price || null,
        allow_club_payment: formData.allow_club_payment,
        has_dinner_option: formData.has_dinner_option,
        daily_schedules: dailySchedules.length > 0 ? dailySchedules : null,
        status: 'draft',
        user_id: user?.id,
        club_id: selectedClubId,
        court_names: selectedCourtNames,
      },
    ]).select();

    if (submitError) {
      setError(submitError.message);
      setLoading(false);
      return;
    }

    if (!tournamentData || tournamentData.length === 0) {
      setError(t.tournament.errorCreate);
      setLoading(false);
      return;
    }

    // Torneio criado! Categorias serão adicionadas depois
    onSuccess();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">{t.tournament.create}</h2>
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
              placeholder={t.tournament.namePlaceholder}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t.tournament.description}</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Add tournament details, rules, or any additional information..."
            />
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
                    <span className="font-semibold">{t.tournament.uploadClick}</span> {t.tournament.uploadDrag}
                  </p>
                  <p className="text-xs text-gray-500">{t.tournament.uploadHint}</p>
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
              <TimeInput24h
                value={formData.daily_start_time}
                onChange={(value) => setFormData({ ...formData, daily_start_time: value })}
              />
              <p className="text-xs text-gray-500 mt-1">{t.tournament.dailyStartTimeHelper}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t.tournament.dailyEndTime} *
              </label>
              <TimeInput24h
                value={formData.daily_end_time}
                onChange={(value) => setFormData({ ...formData, daily_end_time: value })}
              />
              <p className="text-xs text-gray-500 mt-1">{t.tournament.dailyEndTimeHelper}</p>
            </div>
          </div>

          {dailySchedules.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{t.tournament.customizeSchedule}</h3>
              <p className="text-xs text-gray-600 mb-3">{t.tournament.customizeScheduleHelper}</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {dailySchedules.map((schedule, index) => (
                  <div key={index} className="grid grid-cols-3 gap-2 items-center bg-white p-2 rounded border border-gray-200">
                    <div className="text-sm font-medium text-gray-700">
                      {(() => {
                        const d = new Date(schedule.date + 'T00:00:00');
                        return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
                      })()}
                    </div>
                    <TimeInput24h
                      value={schedule.start_time}
                      onChange={(value) => {
                        const updated = [...dailySchedules];
                        updated[index].start_time = value;
                        setDailySchedules(updated);
                      }}
                    />
                    <TimeInput24h
                      value={schedule.end_time}
                      onChange={(value) => {
                        const updated = [...dailySchedules];
                        updated[index].end_time = value;
                        setDailySchedules(updated);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
                <option key={min} value={min}>{min} {t.tournament.minutes}</option>
              ))}
              {Array.from({ length: 20 }, (_, i) => 25 + i * 5).map((min) => (
                <option key={min} value={min}>{min} {t.tournament.minutes}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              {t.tournament.matchDurationHelper}
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="text-base font-semibold text-gray-900 mb-3">Preço de Inscrição</h3>
            <p className="text-xs text-gray-500 mb-4">Defina preços diferenciados para membros e não-membros do clube</p>
            
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preço Membros (€)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.member_price}
                  onChange={(e) =>
                    setFormData({ ...formData, member_price: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500 mt-1">Preço para membros do clube</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Preço Não-Membros (€)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.non_member_price}
                  onChange={(e) =>
                    setFormData({ ...formData, non_member_price: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-500 mt-1">Preço para não-membros</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="allow_club_payment"
                checked={formData.allow_club_payment}
                onChange={(e) => setFormData({ ...formData, allow_club_payment: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <label htmlFor="allow_club_payment" className="text-sm font-medium text-gray-700">
                Permitir pagamento no clube
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1 ml-7">
              Se ativo, os jogadores podem escolher pagar no clube em vez de pagar online. O gestor do clube marca o pagamento na app Manager.
            </p>

            <div className="flex items-center gap-3 mt-3">
              <input
                type="checkbox"
                id="has_dinner_option"
                checked={formData.has_dinner_option}
                onChange={(e) => setFormData({ ...formData, has_dinner_option: e.target.checked })}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
              />
              <label htmlFor="has_dinner_option" className="text-sm font-medium text-gray-700">
                🍽️ Opção de jantar
              </label>
            </div>
            <p className="text-xs text-gray-500 mt-1 ml-7">
              Se ativo, os jogadores podem indicar na inscrição se querem jantar.
            </p>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <h3 className="text-base font-semibold text-gray-900 mb-3">{t.tournament.clubAndCourts} *</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t.tournament.selectClubLabel}</label>
                <select
                  value={selectedClubId}
                  onChange={(e) => {
                    setSelectedClubId(e.target.value);
                    setSelectedCourtNames([]);
                  }}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                  required
                >
                  <option value="">{t.tournament.chooseClubPlaceholder}</option>
                  {clubs.map((club) => (
                    <option key={club.id} value={club.id}>{club.name}</option>
                  ))}
                </select>
              </div>

              {selectedClubId && clubCourts.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-700">{t.tournament.courtsForTournament}</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllCourts}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        {t.tournament.selectAll}
                      </button>
                      <span className="text-gray-300">|</span>
                      <button
                        type="button"
                        onClick={clearCourtSelection}
                        className="text-xs text-gray-600 hover:text-gray-800"
                      >
                        {t.tournament.clearSelection}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {clubCourts.map((court) => (
                      <label
                        key={court.id}
                        className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${
                          selectedCourtNames.includes(court.name)
                            ? 'bg-blue-100 border-2 border-blue-400'
                            : 'bg-white border border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedCourtNames.includes(court.name)}
                          onChange={() => toggleCourtSelection(court.name)}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 font-medium">{court.name}</span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-green-600 mt-2 font-medium">
                    {selectedCourtNames.length} {t.tournament.courtsSelectedCount}
                  </p>
                </div>
              )}

              {selectedClubId && clubCourts.length === 0 && (
                <p className="text-sm text-amber-600 bg-amber-50 p-3 rounded-lg">
                  {t.tournament.noCourtsInClub}
                </p>
              )}

              {!selectedClubId && (
                <p className="text-xs text-gray-500">
                  {t.tournament.selectClubToSeeCourts}
                </p>
              )}
            </div>
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
              {loading ? t.message.saving : t.tournament.create}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
