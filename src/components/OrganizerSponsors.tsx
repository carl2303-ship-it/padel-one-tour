import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import {
  Plus,
  X,
  Edit2,
  Trash2,
  Check,
  Award,
  Gift,
  DollarSign,
  Image,
  Trophy,
  Users,
  Calendar,
  ChevronDown,
} from 'lucide-react';

interface Sponsor {
  id: string;
  organizer_id: string;
  tournament_id: string | null;
  name: string;
  logo_url: string | null;
  contribution_type: 'money' | 'voucher' | 'both';
  money_amount: number | null;
  voucher_description: string | null;
  voucher_quantity: number | null;
  is_active: boolean;
  created_at: string;
  tournament?: { id: string; name: string } | null;
}

interface Prize {
  id: string;
  sponsor_id: string;
  tournament_id: string;
  player_phone: string | null;
  player_name: string;
  prize_type: 'money' | 'voucher';
  prize_description: string;
  prize_value: number | null;
  position: number | null;
  distribution_method: 'manual' | 'auto_position';
  awarded_at: string;
  sponsor?: { name: string };
}

interface TournamentOption {
  id: string;
  name: string;
}

interface PlayerOption {
  id: string;
  name: string;
  phone_number: string | null;
}

type TabKey = 'sponsors' | 'prizes' | 'history';

const TABS: { key: TabKey; icon: typeof Users; labelKey: string; fallback: string }[] = [
  { key: 'sponsors', icon: Users, labelKey: 'sponsorsList', fallback: 'Patrocinadores' },
  { key: 'prizes', icon: Gift, labelKey: 'prizeDistribution', fallback: 'Distribuir Premios' },
  { key: 'history', icon: Calendar, labelKey: 'prizeHistory', fallback: 'Historico de Premios' },
];

const CONTRIBUTION_TYPES = [
  { value: 'money' as const, icon: DollarSign, color: 'emerald' },
  { value: 'voucher' as const, icon: Gift, color: 'amber' },
  { value: 'both' as const, icon: Award, color: 'purple' },
];

function ContributionBadge({ type }: { type: 'money' | 'voucher' | 'both' }) {
  const config = {
    money: { bg: 'bg-emerald-100 text-emerald-700', label: 'Dinheiro' },
    voucher: { bg: 'bg-amber-100 text-amber-700', label: 'Voucher' },
    both: { bg: 'bg-purple-100 text-purple-700', label: 'Ambos' },
  };
  const c = config[type];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${c.bg}`}>{c.label}</span>;
}

export default function OrganizerSponsors() {
  const { t } = useI18n();
  const { user } = useAuth();
  const ts = (key: string, fallback: string) => (t as any).organizerSponsors?.[key] || fallback;

  const [activeTab, setActiveTab] = useState<TabKey>('sponsors');
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [loading, setLoading] = useState(false);

  const [showSponsorModal, setShowSponsorModal] = useState(false);
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const [sponsorForm, setSponsorForm] = useState({
    name: '',
    tournament_id: '' as string,
    contribution_type: 'money' as 'money' | 'voucher' | 'both',
    money_amount: '' as string,
    voucher_description: '',
    voucher_quantity: '' as string,
    is_active: true,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [tournamentSponsors, setTournamentSponsors] = useState<Sponsor[]>([]);
  const [tournamentPlayers, setTournamentPlayers] = useState<PlayerOption[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [awardingSponsorId, setAwardingSponsorId] = useState('');
  const [prizeForm, setPrizeForm] = useState({
    player_id: '',
    player_name: '',
    player_phone: '' as string,
    prize_type: 'voucher' as 'money' | 'voucher',
    prize_description: '',
    prize_value: '' as string,
    distribution_method: 'manual' as 'manual' | 'auto_position',
    position: '' as string,
  });

  const [historyPrizes, setHistoryPrizes] = useState<Prize[]>([]);
  const [historyTournamentFilter, setHistoryTournamentFilter] = useState('');
  const [distributing, setDistributing] = useState(false);

  const loadTournaments = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setTournaments(data);
  }, [user]);

  const loadSponsors = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('tournament_sponsors')
      .select('*, tournament:tournaments(id, name)')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setSponsors(data as Sponsor[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadTournaments();
    loadSponsors();
  }, [loadTournaments, loadSponsors]);

  const loadTournamentSponsors = useCallback(async () => {
    if (!selectedTournamentId || !user) return;
    const { data } = await supabase
      .from('tournament_sponsors')
      .select('*')
      .eq('organizer_id', user.id)
      .eq('tournament_id', selectedTournamentId)
      .eq('is_active', true);
    if (data) setTournamentSponsors(data as Sponsor[]);
  }, [selectedTournamentId, user]);

  const loadTournamentPlayers = useCallback(async () => {
    if (!selectedTournamentId) return;
    const { data } = await supabase
      .from('players')
      .select('id, name, phone_number')
      .eq('tournament_id', selectedTournamentId)
      .order('name');
    if (data) setTournamentPlayers(data);
  }, [selectedTournamentId]);

  const loadPrizes = useCallback(async () => {
    if (!selectedTournamentId) return;
    const { data } = await supabase
      .from('sponsor_prizes')
      .select('*, sponsor:tournament_sponsors(name)')
      .eq('tournament_id', selectedTournamentId)
      .order('awarded_at', { ascending: false });
    if (data) setPrizes(data as Prize[]);
  }, [selectedTournamentId]);

  useEffect(() => {
    if (selectedTournamentId) {
      loadTournamentSponsors();
      loadTournamentPlayers();
      loadPrizes();
    }
  }, [selectedTournamentId, loadTournamentSponsors, loadTournamentPlayers, loadPrizes]);

  const loadHistory = useCallback(async () => {
    if (!user) return;
    let query = supabase
      .from('sponsor_prizes')
      .select('*, sponsor:tournament_sponsors!inner(name, organizer_id)')
      .eq('sponsor.organizer_id', user.id)
      .order('awarded_at', { ascending: false });

    if (historyTournamentFilter) {
      query = query.eq('tournament_id', historyTournamentFilter);
    }
    const { data } = await query;
    if (data) setHistoryPrizes(data as Prize[]);
  }, [user, historyTournamentFilter]);

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab, loadHistory]);

  const openCreateSponsor = () => {
    setEditingSponsor(null);
    setSponsorForm({
      name: '',
      tournament_id: '',
      contribution_type: 'money',
      money_amount: '',
      voucher_description: '',
      voucher_quantity: '',
      is_active: true,
    });
    setLogoFile(null);
    setLogoPreview(null);
    setShowSponsorModal(true);
  };

  const openEditSponsor = (s: Sponsor) => {
    setEditingSponsor(s);
    setSponsorForm({
      name: s.name,
      tournament_id: s.tournament_id || '',
      contribution_type: s.contribution_type,
      money_amount: s.money_amount?.toString() || '',
      voucher_description: s.voucher_description || '',
      voucher_quantity: s.voucher_quantity?.toString() || '',
      is_active: s.is_active,
    });
    setLogoPreview(s.logo_url);
    setLogoFile(null);
    setShowSponsorModal(true);
  };

  const uploadLogo = async (file: File): Promise<string | null> => {
    const ext = file.name.split('.').pop();
    const path = `sponsors/${user!.id}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('tournament-images').upload(path, file, { upsert: true });
    if (error) {
      console.error('Logo upload error:', error);
      return null;
    }
    const { data } = supabase.storage.from('tournament-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const saveSponsor = async () => {
    if (!user || !sponsorForm.name.trim()) return;
    setSaving(true);

    let logoUrl = editingSponsor?.logo_url || null;
    if (logoFile) {
      const uploaded = await uploadLogo(logoFile);
      if (uploaded) logoUrl = uploaded;
    }

    const payload = {
      organizer_id: user.id,
      name: sponsorForm.name.trim(),
      tournament_id: sponsorForm.tournament_id || null,
      contribution_type: sponsorForm.contribution_type,
      money_amount: sponsorForm.contribution_type !== 'voucher' && sponsorForm.money_amount
        ? parseFloat(sponsorForm.money_amount) : null,
      voucher_description: sponsorForm.contribution_type !== 'money'
        ? sponsorForm.voucher_description.trim() || null : null,
      voucher_quantity: sponsorForm.contribution_type !== 'money' && sponsorForm.voucher_quantity
        ? parseInt(sponsorForm.voucher_quantity) : null,
      is_active: sponsorForm.is_active,
      logo_url: logoUrl,
    };

    if (editingSponsor) {
      await supabase.from('tournament_sponsors').update(payload).eq('id', editingSponsor.id);
    } else {
      await supabase.from('tournament_sponsors').insert(payload);
    }

    setSaving(false);
    setShowSponsorModal(false);
    loadSponsors();
  };

  const deleteSponsor = async (id: string) => {
    if (!confirm(ts('confirmDelete', 'Tem certeza que deseja eliminar este patrocinador?'))) return;
    await supabase.from('tournament_sponsors').delete().eq('id', id);
    loadSponsors();
  };

  const toggleSponsorActive = async (s: Sponsor) => {
    await supabase.from('tournament_sponsors').update({ is_active: !s.is_active }).eq('id', s.id);
    loadSponsors();
  };

  const openAwardPrize = (sponsorId: string) => {
    setAwardingSponsorId(sponsorId);
    setPrizeForm({
      player_id: '',
      player_name: '',
      player_phone: '',
      prize_type: 'voucher',
      prize_description: '',
      prize_value: '',
      distribution_method: 'manual',
      position: '',
    });
    setShowPrizeModal(true);
  };

  const savePrize = async () => {
    if (!selectedTournamentId || !awardingSponsorId) return;
    setSaving(true);

    const selectedPlayer = tournamentPlayers.find(p => p.id === prizeForm.player_id);

    await supabase.from('sponsor_prizes').insert({
      sponsor_id: awardingSponsorId,
      tournament_id: selectedTournamentId,
      player_name: selectedPlayer?.name || prizeForm.player_name,
      player_phone: selectedPlayer?.phone_number || prizeForm.player_phone || null,
      prize_type: prizeForm.prize_type,
      prize_description: prizeForm.prize_description.trim(),
      prize_value: prizeForm.prize_value ? parseFloat(prizeForm.prize_value) : null,
      position: prizeForm.position ? parseInt(prizeForm.position) : null,
      distribution_method: prizeForm.distribution_method,
      awarded_at: new Date().toISOString(),
    });

    setSaving(false);
    setShowPrizeModal(false);
    loadPrizes();
  };

  const autoDistribute = async () => {
    if (!selectedTournamentId || tournamentSponsors.length === 0) return;
    setDistributing(true);

    const { data: standings } = await supabase
      .from('players')
      .select('id, name, phone_number')
      .eq('tournament_id', selectedTournamentId)
      .order('name');

    if (!standings || standings.length === 0) {
      setDistributing(false);
      return;
    }

    const prizesToInsert: any[] = [];
    for (const sponsor of tournamentSponsors) {
      const qty = sponsor.voucher_quantity || 1;
      for (let i = 0; i < Math.min(qty, standings.length); i++) {
        prizesToInsert.push({
          sponsor_id: sponsor.id,
          tournament_id: selectedTournamentId,
          player_name: standings[i].name,
          player_phone: standings[i].phone_number,
          prize_type: sponsor.contribution_type === 'money' ? 'money' : 'voucher',
          prize_description: sponsor.voucher_description || `${ts('prizeFrom', 'Premio de')} ${sponsor.name}`,
          prize_value: sponsor.money_amount,
          position: i + 1,
          distribution_method: 'auto_position',
          awarded_at: new Date().toISOString(),
        });
      }
    }

    if (prizesToInsert.length > 0) {
      await supabase.from('sponsor_prizes').insert(prizesToInsert);
    }

    setDistributing(false);
    loadPrizes();
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const getPrizesForSponsor = (sponsorId: string) => prizes.filter(p => p.sponsor_id === sponsorId);

  const groupedHistory = historyPrizes.reduce<Record<string, Prize[]>>((acc, prize) => {
    const key = prize.tournament_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(prize);
    return acc;
  }, {});

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Trophy className="w-6 h-6 text-purple-600" />
        <h2 className="text-2xl font-bold text-gray-800">{ts('title', 'Gestao de Patrocinadores')}</h2>
      </div>

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
        {TABS.map(({ key, icon: Icon, labelKey, fallback }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
              activeTab === key
                ? 'bg-white text-purple-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {ts(labelKey, fallback)}
          </button>
        ))}
      </div>

      {activeTab === 'sponsors' && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">
              {sponsors.length} {ts('sponsorsCount', 'patrocinador(es)')}
            </p>
            <button
              onClick={openCreateSponsor}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              {ts('addSponsor', 'Adicionar Patrocinador')}
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12 text-gray-400">{ts('loading', 'A carregar...')}</div>
          ) : sponsors.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              <Trophy className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">{ts('noSponsors', 'Nenhum patrocinador registado')}</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {sponsors.map(s => (
                <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      {s.logo_url ? (
                        <img src={s.logo_url} alt={s.name} className="w-14 h-14 rounded-lg object-cover border border-gray-100" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-purple-50 flex items-center justify-center">
                          <Image className="w-6 h-6 text-purple-300" />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-800">{s.name}</h3>
                          <ContributionBadge type={s.contribution_type} />
                          {!s.is_active && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                              {ts('inactive', 'Inativo')}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-sm text-gray-500">
                          {s.money_amount != null && (
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                              {s.money_amount.toFixed(2)} EUR
                            </span>
                          )}
                          {s.voucher_description && (
                            <span className="flex items-center gap-1">
                              <Gift className="w-3.5 h-3.5 text-amber-500" />
                              {s.voucher_description}
                              {s.voucher_quantity && ` (x${s.voucher_quantity})`}
                            </span>
                          )}
                          {s.tournament && (
                            <span className="flex items-center gap-1">
                              <Trophy className="w-3.5 h-3.5 text-purple-400" />
                              {s.tournament.name}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleSponsorActive(s)}
                        className={`p-2 rounded-lg transition-colors ${
                          s.is_active
                            ? 'text-emerald-600 hover:bg-emerald-50'
                            : 'text-gray-400 hover:bg-gray-50'
                        }`}
                        title={s.is_active ? ts('deactivate', 'Desativar') : ts('activate', 'Ativar')}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => openEditSponsor(s)}
                        className="p-2 rounded-lg text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-colors"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteSponsor(s.id)}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'prizes' && (
        <div>
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {ts('selectTournament', 'Selecionar Torneio')}
            </label>
            <div className="relative">
              <select
                value={selectedTournamentId}
                onChange={e => setSelectedTournamentId(e.target.value)}
                className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">{ts('chooseTournament', '-- Escolher torneio --')}</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {selectedTournamentId && (
            <>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-gray-700">
                  {ts('tournamentSponsors', 'Patrocinadores do Torneio')}
                </h3>
                <button
                  onClick={autoDistribute}
                  disabled={distributing || tournamentSponsors.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition-colors text-sm font-medium disabled:opacity-50"
                >
                  <Award className="w-4 h-4" />
                  {distributing
                    ? ts('distributing', 'A distribuir...')
                    : ts('autoDistribute', 'Auto-distribuir Premios')}
                </button>
              </div>

              {tournamentSponsors.length === 0 ? (
                <div className="text-center py-10 bg-white rounded-xl border border-gray-100">
                  <Gift className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500 text-sm">{ts('noTournamentSponsors', 'Nenhum patrocinador associado a este torneio')}</p>
                </div>
              ) : (
                <div className="grid gap-4 mb-6">
                  {tournamentSponsors.map(s => {
                    const awarded = getPrizesForSponsor(s.id);
                    const totalQty = s.voucher_quantity || 0;
                    return (
                      <div key={s.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <h4 className="font-semibold text-gray-800">{s.name}</h4>
                            <ContributionBadge type={s.contribution_type} />
                          </div>
                          <button
                            onClick={() => openAwardPrize(s.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                          >
                            <Award className="w-3.5 h-3.5" />
                            {ts('awardPrize', 'Atribuir Premio')}
                          </button>
                        </div>

                        {totalQty > 0 && (
                          <div className="mb-3">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                              <span>{ts('awarded', 'Atribuidos')}: {awarded.length} / {totalQty}</span>
                              <span>{Math.round((awarded.length / totalQty) * 100)}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2">
                              <div
                                className="bg-purple-500 rounded-full h-2 transition-all"
                                style={{ width: `${Math.min(100, (awarded.length / totalQty) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {awarded.length > 0 && (
                          <div className="border-t border-gray-50 pt-3 mt-2">
                            <p className="text-xs font-medium text-gray-500 mb-2">{ts('awardedPrizes', 'Premios atribuidos')}:</p>
                            <div className="space-y-1.5">
                              {awarded.map(p => (
                                <div key={p.id} className="flex items-center justify-between text-sm">
                                  <span className="text-gray-700">
                                    {p.position && <span className="text-purple-600 font-medium">#{p.position} </span>}
                                    {p.player_name}
                                  </span>
                                  <span className="text-gray-500 text-xs">{p.prize_description}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {ts('filterByTournament', 'Filtrar por Torneio')}
            </label>
            <div className="relative">
              <select
                value={historyTournamentFilter}
                onChange={e => setHistoryTournamentFilter(e.target.value)}
                className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">{ts('allTournaments', 'Todos os torneios')}</option>
                {tournaments.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {historyPrizes.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-gray-100">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">{ts('noHistory', 'Nenhum premio atribuido')}</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedHistory).map(([tournamentId, tPrizes]) => {
                const tournamentName = tournaments.find(t => t.id === tournamentId)?.name || tournamentId;
                return (
                  <div key={tournamentId}>
                    <div className="flex items-center gap-2 mb-3">
                      <Trophy className="w-4 h-4 text-purple-500" />
                      <h3 className="font-semibold text-gray-700">{tournamentName}</h3>
                      <span className="text-xs text-gray-400">({tPrizes.length})</span>
                    </div>
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 divide-y divide-gray-50">
                      {tPrizes.map(p => (
                        <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-800">{p.player_name}</span>
                              {p.position && (
                                <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded font-medium">
                                  #{p.position}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-500 mt-0.5">
                              {p.prize_description}
                              {p.prize_value != null && ` - ${p.prize_value.toFixed(2)} EUR`}
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              {p.sponsor?.name && `${ts('from', 'De')}: ${p.sponsor.name}`}
                              {' | '}
                              {new Date(p.awarded_at).toLocaleDateString()}
                            </p>
                          </div>
                          <div>
                            {p.prize_type === 'money' ? (
                              <DollarSign className="w-5 h-5 text-emerald-500" />
                            ) : (
                              <Gift className="w-5 h-5 text-amber-500" />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showSponsorModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingSponsor ? ts('editSponsor', 'Editar Patrocinador') : ts('newSponsor', 'Novo Patrocinador')}
              </h3>
              <button onClick={() => setShowSponsorModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('sponsorName', 'Nome')}</label>
                <input
                  type="text"
                  value={sponsorForm.name}
                  onChange={e => setSponsorForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder={ts('sponsorNamePlaceholder', 'Nome do patrocinador')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('tournament', 'Torneio')}</label>
                <div className="relative">
                  <select
                    value={sponsorForm.tournament_id}
                    onChange={e => setSponsorForm(f => ({ ...f, tournament_id: e.target.value }))}
                    className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="">{ts('noTournament', 'Sem torneio especifico')}</option>
                    {tournaments.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{ts('contributionType', 'Tipo de Contribuicao')}</label>
                <div className="flex gap-2">
                  {CONTRIBUTION_TYPES.map(({ value, icon: CIcon, color }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSponsorForm(f => ({ ...f, contribution_type: value }))}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                        sponsorForm.contribution_type === value
                          ? `border-${color}-500 bg-${color}-50 text-${color}-700`
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <CIcon className="w-4 h-4" />
                      {value === 'money' ? ts('money', 'Dinheiro') : value === 'voucher' ? ts('voucher', 'Voucher') : ts('both', 'Ambos')}
                    </button>
                  ))}
                </div>
              </div>

              {sponsorForm.contribution_type !== 'voucher' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{ts('moneyAmount', 'Valor (EUR)')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={sponsorForm.money_amount}
                    onChange={e => setSponsorForm(f => ({ ...f, money_amount: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                </div>
              )}

              {sponsorForm.contribution_type !== 'money' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{ts('voucherDescription', 'Descricao do Voucher')}</label>
                    <textarea
                      value={sponsorForm.voucher_description}
                      onChange={e => setSponsorForm(f => ({ ...f, voucher_description: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                      rows={2}
                      placeholder={ts('voucherDescriptionPlaceholder', 'Ex: Vale de 50EUR em material desportivo')}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{ts('voucherQuantity', 'Quantidade de Vouchers')}</label>
                    <input
                      type="number"
                      min="1"
                      value={sponsorForm.voucher_quantity}
                      onChange={e => setSponsorForm(f => ({ ...f, voucher_quantity: e.target.value }))}
                      className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      placeholder="1"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('logo', 'Logotipo')}</label>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Logo" className="w-16 h-16 rounded-lg object-cover border border-gray-100" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-gray-50 flex items-center justify-center border border-dashed border-gray-200">
                      <Image className="w-6 h-6 text-gray-300" />
                    </div>
                  )}
                  <label className="cursor-pointer px-4 py-2 bg-gray-100 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-200 transition-colors">
                    {ts('uploadLogo', 'Carregar imagem')}
                    <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                  </label>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSponsorForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    sponsorForm.is_active ? 'bg-purple-600' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      sponsorForm.is_active ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
                <span className="text-sm text-gray-700">{ts('active', 'Ativo')}</span>
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowSponsorModal(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {ts('cancel', 'Cancelar')}
              </button>
              <button
                onClick={saveSponsor}
                disabled={saving || !sponsorForm.name.trim()}
                className="flex items-center gap-2 px-5 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {saving ? ts('saving', 'A guardar...') : editingSponsor ? ts('save', 'Guardar') : ts('create', 'Criar')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrizeModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">{ts('awardPrize', 'Atribuir Premio')}</h3>
              <button onClick={() => setShowPrizeModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('distributionMethod', 'Metodo de Distribuicao')}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPrizeForm(f => ({ ...f, distribution_method: 'manual' }))}
                    className={`flex-1 py-2 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      prizeForm.distribution_method === 'manual'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    {ts('manual', 'Manual')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrizeForm(f => ({ ...f, distribution_method: 'auto_position' }))}
                    className={`flex-1 py-2 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      prizeForm.distribution_method === 'auto_position'
                        ? 'border-purple-500 bg-purple-50 text-purple-700'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    {ts('byPosition', 'Por Posicao')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('player', 'Jogador')}</label>
                <div className="relative">
                  <select
                    value={prizeForm.player_id}
                    onChange={e => {
                      const player = tournamentPlayers.find(p => p.id === e.target.value);
                      setPrizeForm(f => ({
                        ...f,
                        player_id: e.target.value,
                        player_name: player?.name || '',
                        player_phone: player?.phone_number || '',
                      }));
                    }}
                    className="w-full appearance-none bg-white border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="">{ts('selectPlayer', '-- Selecionar jogador --')}</option>
                    {tournamentPlayers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>

              {prizeForm.distribution_method === 'auto_position' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{ts('position', 'Posicao')}</label>
                  <input
                    type="number"
                    min="1"
                    value={prizeForm.position}
                    onChange={e => setPrizeForm(f => ({ ...f, position: e.target.value }))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder="1"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('prizeType', 'Tipo de Premio')}</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPrizeForm(f => ({ ...f, prize_type: 'money' }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      prizeForm.prize_type === 'money'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    {ts('money', 'Dinheiro')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrizeForm(f => ({ ...f, prize_type: 'voucher' }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl border-2 text-sm font-medium transition-all ${
                      prizeForm.prize_type === 'voucher'
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    <Gift className="w-4 h-4" />
                    {ts('voucher', 'Voucher')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('prizeDescription', 'Descricao do Premio')}</label>
                <textarea
                  value={prizeForm.prize_description}
                  onChange={e => setPrizeForm(f => ({ ...f, prize_description: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                  rows={2}
                  placeholder={ts('prizeDescriptionPlaceholder', 'Descricao do premio')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{ts('prizeValue', 'Valor (EUR)')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={prizeForm.prize_value}
                  onChange={e => setPrizeForm(f => ({ ...f, prize_value: e.target.value }))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowPrizeModal(false)}
                className="px-4 py-2 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                {ts('cancel', 'Cancelar')}
              </button>
              <button
                onClick={savePrize}
                disabled={saving || !prizeForm.prize_description.trim() || (!prizeForm.player_id && !prizeForm.player_name)}
                className="flex items-center gap-2 px-5 py-2 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                <Award className="w-4 h-4" />
                {saving ? ts('saving', 'A guardar...') : ts('award', 'Atribuir')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
