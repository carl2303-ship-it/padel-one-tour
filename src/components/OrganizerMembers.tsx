import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import {
  Plus, X, Users, Edit2, Trash2, Check, Mail, Phone,
  User, Trophy, Eye, Calendar, Medal, Download,
  ArrowUpDown, Award, Upload, CreditCard
} from 'lucide-react';
import ImportContactsModal from './ImportContactsModal';

interface MembershipPlan {
  id: string;
  name: string;
  duration_months: number;
  price: number;
  benefits: string[];
  tournament_discount_percent: number;
  is_active: boolean;
}

interface Subscription {
  id: string;
  member_name: string | null;
  member_email: string | null;
  member_phone: string | null;
  start_date: string;
  end_date: string;
  status: string;
  amount_paid: number;
  notes: string | null;
  plan: MembershipPlan;
  plan_id: string;
  player_account?: {
    birth_date: string | null;
    gender: 'male' | 'female' | 'other' | null;
  } | null;
}

interface TournamentHistory {
  tournament_id: string;
  tournament_name: string;
  start_date: string;
  end_date: string;
  category_name: string | null;
  final_position: number | null;
  payment_status: string | null;
}

type Tab = 'plans' | 'members';
type StatusFilter = 'all' | 'active' | 'expired';
type SortField = 'name' | 'phone' | 'plan' | 'date' | 'status';
type GenderFilter = 'all' | 'male' | 'female';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s().-]/g, '');
  let hadPrefix = false;
  if (cleaned.startsWith('+00')) { cleaned = cleaned.slice(3); hadPrefix = true; }
  else if (cleaned.startsWith('+')) { cleaned = cleaned.slice(1); hadPrefix = true; }
  else if (cleaned.startsWith('00')) { cleaned = cleaned.slice(2); hadPrefix = true; }
  
  if (hadPrefix) {
    cleaned = cleaned.replace(/^(351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|212|213|216|244|245|258|297|298|299|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|992|993|994|995|996|997|998)(?=\d{7,})/, '');
    cleaned = cleaned.replace(/^(20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98)(?=\d{7,})/, '');
    cleaned = cleaned.replace(/^[17](?=\d{9,})/, '');
  } else {
    cleaned = cleaned.replace(/^351(?=[29]\d{8}$)/, '');
  }
  
  if (cleaned.startsWith('0') && cleaned.length >= 9) {
    cleaned = cleaned.slice(1);
  }
  
  return cleaned;
}

export default function OrganizerMembers() {
  const { t } = useI18n();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('members');
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null);
  const [planForm, setPlanForm] = useState({
    name: '',
    duration_months: 1,
    price: 0,
    benefits: '',
    tournament_discount_percent: 0,
    is_active: true,
  });

  const [showMemberModal, setShowMemberModal] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
  const [memberForm, setMemberForm] = useState({
    member_phone: '',
    member_email: '',
    member_name: '',
    plan_id: '',
    amount_paid: 0,
    notes: '',
    status: 'active',
    start_date: new Date().toISOString().split('T')[0],
  });
  const [phoneLookupDone, setPhoneLookupDone] = useState(false);

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyPlayer, setHistoryPlayer] = useState<{ name: string; phone: string } | null>(null);
  const [tournamentHistory, setTournamentHistory] = useState<TournamentHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [filterGender, setFilterGender] = useState<GenderFilter>('all');
  const [filterAge, setFilterAge] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => {
    if (user) {
      loadPlans();
      loadSubscriptions();
    }
  }, [user]);

  async function loadPlans() {
    const { data } = await supabase
      .from('membership_plans')
      .select('*')
      .eq('user_id', user!.id)
      .order('name');
    if (data) setPlans(data);
  }

  async function loadSubscriptions() {
    setLoading(true);

    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('member_subscriptions')
      .update({ status: 'expired' })
      .eq('club_owner_id', user!.id)
      .eq('status', 'active')
      .lt('end_date', today);

    const { data } = await supabase
      .from('member_subscriptions')
      .select('*, plan:membership_plans(*)')
      .eq('club_owner_id', user!.id)
      .order('member_name');

    if (data) {
      const enriched = await Promise.all(
        (data as Subscription[]).map(async (sub) => {
          if (!sub.member_phone) return { ...sub, player_account: null };
          const normalized = normalizePhone(sub.member_phone);
          const { data: account } = await supabase
            .from('player_accounts')
            .select('birth_date, gender')
            .or(`phone_number.eq.${normalized},phone_number.eq.${sub.member_phone}`)
            .maybeSingle();
          return { ...sub, player_account: account };
        }),
      );
      setSubscriptions(enriched);
    }

    setLoading(false);
  }

  async function savePlan() {
    const benefitsArray = planForm.benefits
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);

    const payload = {
      user_id: user!.id,
      name: planForm.name,
      duration_months: planForm.duration_months,
      price: planForm.price,
      benefits: benefitsArray,
      tournament_discount_percent: planForm.tournament_discount_percent,
      is_active: planForm.is_active,
    };

    if (editingPlan) {
      await supabase.from('membership_plans').update(payload).eq('id', editingPlan.id);
    } else {
      await supabase.from('membership_plans').insert(payload);
    }

    setShowPlanModal(false);
    setEditingPlan(null);
    loadPlans();
  }

  async function deletePlan(planId: string) {
    if (!confirm((t as any).organizerMembers?.confirmDeletePlan || 'Eliminar este plano?')) return;
    await supabase.from('membership_plans').delete().eq('id', planId);
    loadPlans();
  }

  function openPlanModal(plan?: MembershipPlan) {
    if (plan) {
      setEditingPlan(plan);
      setPlanForm({
        name: plan.name,
        duration_months: plan.duration_months,
        price: plan.price,
        benefits: (plan.benefits || []).join('\n'),
        tournament_discount_percent: plan.tournament_discount_percent,
        is_active: plan.is_active,
      });
    } else {
      setEditingPlan(null);
      setPlanForm({
        name: '',
        duration_months: 1,
        price: 0,
        benefits: '',
        tournament_discount_percent: 0,
        is_active: true,
      });
    }
    setShowPlanModal(true);
  }

  async function lookupPhone(phone: string) {
    const normalized = normalizePhone(phone);
    if (normalized.length < 9) return;

    const { data } = await supabase
      .from('players')
      .select('name, phone_number')
      .or(`phone_number.eq.${normalized},phone_number.eq.${phone}`)
      .limit(1)
      .maybeSingle();

    if (data) {
      setMemberForm((prev) => ({
        ...prev,
        member_name: data.name || prev.member_name,
        member_phone: data.phone_number || normalized,
      }));
    }
    setPhoneLookupDone(true);
  }

  function openMemberModal(sub?: Subscription) {
    if (sub) {
      setEditingSubscription(sub);
      setMemberForm({
        member_phone: sub.member_phone || '',
        member_email: sub.member_email || '',
        member_name: sub.member_name || '',
        plan_id: sub.plan_id,
        amount_paid: sub.amount_paid,
        notes: sub.notes || '',
        status: sub.status,
        start_date: sub.start_date,
      });
    } else {
      setEditingSubscription(null);
      setMemberForm({
        member_phone: '',
        member_email: '',
        member_name: '',
        plan_id: plans[0]?.id || '',
        amount_paid: 0,
        notes: '',
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
      });
    }
    setPhoneLookupDone(false);
    setShowMemberModal(true);
  }

  async function saveMember() {
    const selectedPlan = plans.find((p) => p.id === memberForm.plan_id);
    if (!selectedPlan) return;

    const startDate = new Date(memberForm.start_date);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + selectedPlan.duration_months);

    const payload = {
      club_owner_id: user!.id,
      user_id: user!.id,
      member_name: memberForm.member_name,
      member_email: memberForm.member_email || null,
      member_phone: normalizePhone(memberForm.member_phone),
      plan_id: memberForm.plan_id,
      start_date: memberForm.start_date,
      end_date: endDate.toISOString().split('T')[0],
      amount_paid: memberForm.amount_paid,
      notes: memberForm.notes || null,
      status: memberForm.status,
    };

    if (editingSubscription) {
      await supabase.from('member_subscriptions').update(payload).eq('id', editingSubscription.id);
    } else {
      await supabase.from('member_subscriptions').insert(payload);
    }

    setShowMemberModal(false);
    setEditingSubscription(null);
    loadSubscriptions();
  }

  async function deleteMember(subId: string) {
    if (!confirm((t as any).organizerMembers?.confirmDeleteMember || 'Remover este membro?')) return;
    await supabase.from('member_subscriptions').delete().eq('id', subId);
    loadSubscriptions();
  }

  async function viewHistory(sub: Subscription) {
    if (!sub.member_phone) return;
    setHistoryPlayer({ name: sub.member_name || sub.member_phone, phone: sub.member_phone });
    setLoadingHistory(true);
    setTournamentHistory([]);
    setShowHistoryModal(true);

    const normalized = normalizePhone(sub.member_phone);
    const { data: players } = await supabase
      .from('players')
      .select(`
        id,
        tournament_id,
        final_position,
        payment_status,
        category:tournament_categories(name),
        tournament:tournaments(id, name, start_date, end_date)
      `)
      .or(`phone_number.eq.${normalized},phone_number.eq.${sub.member_phone}`)
      .order('created_at', { ascending: false });

    if (players?.length) {
      const history: TournamentHistory[] = players
        .filter(p => p.tournament)
        .flatMap(p => {
          const tournament = Array.isArray(p.tournament) ? p.tournament[0] : p.tournament;
          const category = Array.isArray(p.category) ? p.category[0] : p.category;
          if (!tournament) return [];
          return [{
            tournament_id: tournament.id,
            tournament_name: tournament.name,
            start_date: tournament.start_date,
            end_date: tournament.end_date,
            category_name: category?.name || null,
            final_position: p.final_position,
            payment_status: p.payment_status,
          }];
        });
      setTournamentHistory(
        history.filter((h, idx, arr) => arr.findIndex(item => item.tournament_id === h.tournament_id) === idx),
      );
    }
    setLoadingHistory(false);
  }

  function getAge(birthDate: string | null | undefined): number | null {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function exportCSV() {
    const rows = filteredSubscriptions.map((s) => ({
      Nome: s.member_name || '',
      Telefone: s.member_phone || '',
      Email: s.member_email || '',
      Plano: s.plan?.name || '',
      Inicio: s.start_date,
      Fim: s.end_date,
      Estado: s.status,
      Pago: s.amount_paid,
    }));
    const headers = Object.keys(rows[0] || {}).join(',');
    const csv = [headers, ...rows.map((r) => Object.values(r).join(','))].join('\n');
    downloadFile(csv, 'membros.csv', 'text/csv');
  }

  function exportPhones() {
    const phones = filteredSubscriptions
      .map((s) => s.member_phone)
      .filter(Boolean)
      .join('\n');
    downloadFile(phones, 'telefones.txt', 'text/plain');
  }

  function exportEmails() {
    const emails = filteredSubscriptions
      .map((s) => s.member_email)
      .filter(Boolean)
      .join('\n');
    downloadFile(emails, 'emails.txt', 'text/plain');
  }

  function downloadFile(content: string, filename: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filteredSubscriptions = useMemo(() => {
    let result = [...subscriptions];
    if (statusFilter !== 'all') {
      result = result.filter((s) => s.status === statusFilter);
    }
    if (filterGender !== 'all') {
      result = result.filter(s => s.player_account?.gender === filterGender);
    }
    if (filterAge !== 'all') {
      result = result.filter(s => {
        const age = getAge(s.player_account?.birth_date);
        if (age === null) return false;
        if (filterAge === 'under18') return age < 18;
        if (filterAge === '18-35') return age >= 18 && age <= 35;
        if (filterAge === '36-50') return age >= 36 && age <= 50;
        if (filterAge === 'over50') return age > 50;
        return true;
      });
    }
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = (a.member_name || '').localeCompare(b.member_name || '');
          break;
        case 'phone':
          cmp = (a.member_phone || '').localeCompare(b.member_phone || '');
          break;
        case 'plan':
          cmp = (a.plan?.name || '').localeCompare(b.plan?.name || '');
          break;
        case 'date':
          cmp = (a.end_date || '').localeCompare(b.end_date || '');
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [subscriptions, statusFilter, sortField, sortAsc, filterGender, filterAge]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1">
        <button
          onClick={() => setActiveTab('members')}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'members'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          {(t as any).organizerMembers?.members || 'Membros'}
        </button>
        <button
          onClick={() => setActiveTab('plans')}
          className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
            activeTab === 'plans'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Award className="w-4 h-4" />
          {(t as any).organizerMembers?.plans || 'Planos'}
        </button>
      </div>

      {activeTab === 'plans' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-gray-800">
              {(t as any).organizerMembers?.managePlans || 'Gerir Planos'}
            </h2>
            <button
              onClick={() => openPlanModal()}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {(t as any).organizerMembers?.newPlan || 'Novo Plano'}
            </button>
          </div>

          {plans.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Award className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{(t as any).organizerMembers?.noPlans || 'Nenhum plano criado'}</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 space-y-3"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-semibold text-gray-800">{plan.name}</h3>
                      <p className="text-sm text-gray-500">
                        {plan.duration_months} {(t as any).organizerMembers?.months || 'meses'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                        plan.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {plan.is_active
                        ? (t as any).organizerMembers?.active || 'Ativo'
                        : (t as any).organizerMembers?.inactive || 'Inativo'}
                    </span>
                  </div>
                  <div className="text-2xl font-bold text-blue-600">{plan.price}€</div>
                  {plan.tournament_discount_percent > 0 && (
                    <p className="text-sm text-green-600">
                      <Medal className="w-3.5 h-3.5 inline mr-1" />
                      {plan.tournament_discount_percent}% {(t as any).organizerMembers?.discountTournaments || 'desconto torneios'}
                    </p>
                  )}
                  {plan.benefits && plan.benefits.length > 0 && (
                    <ul className="text-sm text-gray-600 space-y-1">
                      {plan.benefits.map((b, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <Check className="w-3.5 h-3.5 text-green-500 mt-0.5 shrink-0" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => openPlanModal(plan)}
                      className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {(t as any).organizerMembers?.edit || 'Editar'}
                    </button>
                    <button
                      onClick={() => deletePlan(plan.id)}
                      className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {(t as any).organizerMembers?.delete || 'Eliminar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="text-lg font-semibold text-gray-800">
              {(t as any).organizerMembers?.manageMembers || 'Gerir Membros'}
              <span className="ml-2 text-sm font-normal text-gray-500">({filteredSubscriptions.length})</span>
            </h2>
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3 sm:flex sm:items-center">
                <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setFilterGender('all')}
                    className={`flex-1 px-2 py-1 text-xs rounded-md ${filterGender === 'all' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                  >
                    Todos
                  </button>
                  <button
                    onClick={() => setFilterGender('male')}
                    className={`flex-1 px-2 py-1 text-xs rounded-md ${filterGender === 'male' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                  >
                    M
                  </button>
                  <button
                    onClick={() => setFilterGender('female')}
                    className={`flex-1 px-2 py-1 text-xs rounded-md ${filterGender === 'female' ? 'bg-white shadow-sm' : 'text-gray-500'}`}
                  >
                    F
                  </button>
                </div>
                <select
                  value={filterAge}
                  onChange={e => setFilterAge(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg bg-white"
                >
                  <option value="all">Todas idades</option>
                  <option value="under18">&lt;18</option>
                  <option value="18-35">18-35</option>
                  <option value="36-50">36-50</option>
                  <option value="over50">50+</option>
                </select>
                <div className="flex items-center justify-center gap-1 bg-gray-100 rounded-lg p-1">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      statusFilter === 'all' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'
                    }`}
                  >
                    {(t as any).organizerMembers?.all || 'Todos'}
                  </button>
                  <button
                    onClick={() => setStatusFilter('active')}
                    className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      statusFilter === 'active' ? 'bg-white shadow-sm text-green-700' : 'text-gray-500'
                    }`}
                  >
                    {(t as any).organizerMembers?.active || 'Ativos'}
                  </button>
                  <button
                    onClick={() => setStatusFilter('expired')}
                    className={`flex-1 px-2 py-1 text-xs rounded-md transition-colors ${
                      statusFilter === 'expired' ? 'bg-white shadow-sm text-red-700' : 'text-gray-500'
                    }`}
                  >
                    {(t as any).organizerMembers?.expired || 'Expirados'}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowExportMenu((visible) => !visible)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                    aria-expanded={showExportMenu}
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden min-[420px]:inline">Exportar</span>
                  </button>
                  {showExportMenu && (
                    <div className="absolute left-0 top-full z-20 mt-1 min-w-[150px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg sm:left-auto sm:right-0">
                      <button onClick={() => { exportCSV(); setShowExportMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                        CSV
                      </button>
                      <button onClick={() => { exportPhones(); setShowExportMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                        <Phone className="w-3.5 h-3.5 inline mr-2" />
                        {(t as any).organizerMembers?.phoneList || 'Telefones'}
                      </button>
                      <button onClick={() => { exportEmails(); setShowExportMenu(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                        <Mail className="w-3.5 h-3.5 inline mr-2" />
                        Emails
                      </button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowImportModal(true)}
                  className="flex items-center justify-center gap-2 rounded-lg border border-blue-600 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50"
                >
                  <Upload className="w-4 h-4" />
                  <span className="hidden min-[420px]:inline">Importar</span>
                </button>
                <button
                  onClick={() => openMemberModal()}
                  className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden min-[420px]:inline">{(t as any).organizerMembers?.addMember || 'Adicionar'}</span>
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400">A carregar...</div>
          ) : filteredSubscriptions.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              <p>{(t as any).organizerMembers?.noMembers || 'Nenhum membro encontrado'}</p>
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {filteredSubscriptions.map((sub) => (
                  <article key={sub.id} className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 shrink-0 text-gray-400" />
                          <h3 className="truncate font-semibold text-gray-900">{sub.member_name || '-'}</h3>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">{sub.member_phone || '-'}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          sub.status === 'active'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {sub.status === 'active'
                          ? (t as any).organizerMembers?.active || 'Ativo'
                          : (t as any).organizerMembers?.expired || 'Expirado'}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 text-sm">
                      <div>
                        <dt className="text-xs text-gray-400">{(t as any).organizerMembers?.plan || 'Plano'}</dt>
                        <dd className="mt-0.5 font-medium text-gray-700">{sub.plan?.name || '-'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-400">{(t as any).organizerMembers?.expiry || 'Expira'}</dt>
                        <dd className="mt-0.5 flex items-center gap-1 font-medium text-gray-700">
                          <Calendar className="h-3.5 w-3.5 text-gray-400" />
                          {sub.end_date}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <button
                        onClick={() => viewHistory(sub)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-gray-50 px-2 py-2 text-xs font-medium text-gray-600"
                      >
                        <Eye className="h-4 w-4" />
                        Histórico
                      </button>
                      <button
                        onClick={() => openMemberModal(sub)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 px-2 py-2 text-xs font-medium text-blue-700"
                      >
                        <Edit2 className="h-4 w-4" />
                        Editar
                      </button>
                      <button
                        onClick={() => deleteMember(sub.id)}
                        className="flex items-center justify-center gap-1.5 rounded-lg bg-red-50 px-2 py-2 text-xs font-medium text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                        Eliminar
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm md:block">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">
                        <button onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-gray-800">
                          {(t as any).organizerMembers?.name || 'Nome'}
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">
                        <button onClick={() => toggleSort('phone')} className="flex items-center gap-1 hover:text-gray-800">
                          {(t as any).organizerMembers?.phone || 'Telefone'}
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">
                        <button onClick={() => toggleSort('plan')} className="flex items-center gap-1 hover:text-gray-800">
                          {(t as any).organizerMembers?.plan || 'Plano'}
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">
                        <button onClick={() => toggleSort('date')} className="flex items-center gap-1 hover:text-gray-800">
                          {(t as any).organizerMembers?.expiry || 'Expira'}
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">
                        <button onClick={() => toggleSort('status')} className="flex items-center gap-1 hover:text-gray-800">
                          {(t as any).organizerMembers?.status || 'Estado'}
                          <ArrowUpDown className="w-3 h-3" />
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">
                        {(t as any).organizerMembers?.actions || 'Ações'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredSubscriptions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <User className="w-4 h-4 text-gray-400" />
                            <span className="font-medium text-gray-800">{sub.member_name || '-'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{sub.member_phone || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">{sub.plan?.name || '-'}</td>
                        <td className="px-4 py-3 text-gray-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-gray-400" />
                            {sub.end_date}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                              sub.status === 'active'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {sub.status === 'active'
                              ? (t as any).organizerMembers?.active || 'Ativo'
                              : (t as any).organizerMembers?.expired || 'Expirado'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              onClick={() => viewHistory(sub)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 rounded"
                              title={(t as any).organizerMembers?.viewHistory || 'Ver histórico'}
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => openMemberModal(sub)}
                              className="p-1.5 text-gray-400 hover:text-blue-600 rounded"
                              title={(t as any).organizerMembers?.edit || 'Editar'}
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteMember(sub.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                              title={(t as any).organizerMembers?.delete || 'Eliminar'}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </div>
      )}

      {showPlanModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingPlan
                  ? (t as any).organizerMembers?.editPlan || 'Editar Plano'
                  : (t as any).organizerMembers?.newPlan || 'Novo Plano'}
              </h3>
              <button onClick={() => setShowPlanModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {(t as any).organizerMembers?.planName || 'Nome do plano'}
                </label>
                <input
                  type="text"
                  value={planForm.name}
                  onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {(t as any).organizerMembers?.duration || 'Duração (meses)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={planForm.duration_months}
                    onChange={(e) => setPlanForm({ ...planForm, duration_months: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {(t as any).organizerMembers?.price || 'Preço (€)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={planForm.price}
                    onChange={(e) => setPlanForm({ ...planForm, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {(t as any).organizerMembers?.benefits || 'Benefícios (um por linha)'}
                </label>
                <textarea
                  rows={3}
                  value={planForm.benefits}
                  onChange={(e) => setPlanForm({ ...planForm, benefits: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {(t as any).organizerMembers?.tournamentDiscount || 'Desconto torneios (%)'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={planForm.tournament_discount_percent}
                  onChange={(e) =>
                    setPlanForm({ ...planForm, tournament_discount_percent: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={planForm.is_active}
                  onChange={(e) => setPlanForm({ ...planForm, is_active: e.target.checked })}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                  {(t as any).organizerMembers?.planActive || 'Plano ativo'}
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowPlanModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                {(t as any).organizerMembers?.cancel || 'Cancelar'}
              </button>
              <button
                onClick={savePlan}
                disabled={!planForm.name}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(t as any).organizerMembers?.save || 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showMemberModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                {editingSubscription
                  ? (t as any).organizerMembers?.editMember || 'Editar Membro'
                  : (t as any).organizerMembers?.addMember || 'Adicionar Membro'}
              </h3>
              <button onClick={() => setShowMemberModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Phone className="w-3.5 h-3.5 inline mr-1" />
                  {(t as any).organizerMembers?.phone || 'Telefone'}
                </label>
                <input
                  type="tel"
                  value={memberForm.member_phone}
                  onChange={(e) => {
                    setMemberForm({ ...memberForm, member_phone: e.target.value });
                    setPhoneLookupDone(false);
                  }}
                  onBlur={() => {
                    if (!phoneLookupDone && memberForm.member_phone.replace(/[\s\-]/g, '').length >= 9) {
                      lookupPhone(memberForm.member_phone);
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="+351 912 345 678"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <User className="w-3.5 h-3.5 inline mr-1" />
                  {(t as any).organizerMembers?.name || 'Nome'}
                </label>
                <input
                  type="text"
                  value={memberForm.member_name}
                  onChange={(e) => setMemberForm({ ...memberForm, member_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  <Mail className="w-3.5 h-3.5 inline mr-1" />
                  Email
                </label>
                <input
                  type="email"
                  value={memberForm.member_email}
                  onChange={(e) => setMemberForm({ ...memberForm, member_email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {(t as any).organizerMembers?.plan || 'Plano'}
                </label>
                <select
                  value={memberForm.plan_id}
                  onChange={(e) => setMemberForm({ ...memberForm, plan_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">{(t as any).organizerMembers?.selectPlan || 'Selecionar plano'}</option>
                  {plans.filter((p) => p.is_active).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {p.price}€ / {p.duration_months}m
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {(t as any).organizerMembers?.amountPaid || 'Valor pago (€)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={memberForm.amount_paid}
                    onChange={(e) => setMemberForm({ ...memberForm, amount_paid: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    <Calendar className="w-3.5 h-3.5 inline mr-1" />
                    {(t as any).organizerMembers?.startDate || 'Início'}
                  </label>
                  <input
                    type="date"
                    value={memberForm.start_date}
                    onChange={(e) => setMemberForm({ ...memberForm, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
              {editingSubscription && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {(t as any).organizerMembers?.status || 'Estado'}
                  </label>
                  <select
                    value={memberForm.status}
                    onChange={(e) => setMemberForm({ ...memberForm, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="active">{(t as any).organizerMembers?.active || 'Ativo'}</option>
                    <option value="expired">{(t as any).organizerMembers?.expired || 'Expirado'}</option>
                    <option value="cancelled">{(t as any).organizerMembers?.cancelled || 'Cancelado'}</option>
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {(t as any).organizerMembers?.notes || 'Notas'}
                </label>
                <textarea
                  rows={2}
                  value={memberForm.notes}
                  onChange={(e) => setMemberForm({ ...memberForm, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button
                onClick={() => setShowMemberModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                {(t as any).organizerMembers?.cancel || 'Cancelar'}
              </button>
              <button
                onClick={saveMember}
                disabled={!memberForm.member_phone || !memberForm.plan_id}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {(t as any).organizerMembers?.save || 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistoryModal && historyPlayer && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-800">
                <Trophy className="w-4 h-4 inline mr-2 text-yellow-500" />
                {historyPlayer.name}
              </h3>
              <button onClick={() => setShowHistoryModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              {loadingHistory ? (
                <p className="text-gray-500 text-center py-4">A carregar histórico...</p>
              ) : tournamentHistory.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  {(t as any).organizerMembers?.noHistory || 'Sem participações registadas'}
                </p>
              ) : (
                <div className="space-y-2">
                  {tournamentHistory.map(h => (
                    <div key={h.tournament_id} className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="font-medium text-gray-900">{h.tournament_name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {new Date(h.start_date).toLocaleDateString('pt-PT')}
                        {h.category_name && ` · ${h.category_name}`}
                      </p>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {h.final_position && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                            {h.final_position}º lugar
                          </span>
                        )}
                        {h.payment_status && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            h.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                          }`}>
                            {h.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ImportContactsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => {
          loadSubscriptions();
        }}
      />
    </div>
  );
}
