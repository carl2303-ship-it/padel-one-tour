import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useI18n } from '../lib/i18nContext';
import { useAuth } from '../lib/authContext';
import {
  Plus, X, Users, Edit2, Trash2, Check, Mail, Phone,
  User, Trophy, Eye, Calendar, Medal, Filter, Download,
  ArrowUpDown, Award, Upload
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
}

interface Lead {
  name: string;
  phone_number: string;
  tournament_name: string;
}

type Tab = 'plans' | 'members';
type StatusFilter = 'all' | 'active' | 'expired';
type SortField = 'name' | 'phone' | 'plan' | 'date' | 'status';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.length >= 9 && !cleaned.startsWith('+')) {
    cleaned = '+351' + cleaned;
  }
  return cleaned;
}

export default function OrganizerMembers() {
  const { t } = useI18n();
  const { user } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('plans');
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
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
  const [historyPlayer, setHistoryPlayer] = useState<{ name: string; phone: string; tournaments: string[] } | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showImportModal, setShowImportModal] = useState(false);

  useEffect(() => {
    if (user) {
      loadPlans();
      loadSubscriptions();
      loadLeads();
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

    if (data) setSubscriptions(data as Subscription[]);
    setLoading(false);
  }

  async function loadLeads() {
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, name')
      .eq('user_id', user!.id);

    if (!tournaments || tournaments.length === 0) {
      setLeads([]);
      return;
    }

    const tournamentIds = tournaments.map((t: any) => t.id);
    const tournamentMap = Object.fromEntries(tournaments.map((t: any) => [t.id, t.name]));

    const { data: players } = await supabase
      .from('players')
      .select('name, phone_number, tournament_id')
      .in('tournament_id', tournamentIds)
      .not('phone_number', 'is', null);

    if (!players) {
      setLeads([]);
      return;
    }

    const { data: members } = await supabase
      .from('member_subscriptions')
      .select('member_phone')
      .eq('club_owner_id', user!.id);

    const memberPhones = new Set((members || []).map((m: any) => m.member_phone));

    const uniqueLeads = new Map<string, Lead>();
    for (const p of players) {
      if (p.phone_number && !memberPhones.has(p.phone_number) && !uniqueLeads.has(p.phone_number)) {
        uniqueLeads.set(p.phone_number, {
          name: p.name,
          phone_number: p.phone_number,
          tournament_name: tournamentMap[p.tournament_id] || '',
        });
      }
    }
    setLeads(Array.from(uniqueLeads.values()));
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
      .eq('phone_number', normalized)
      .limit(1)
      .single();

    if (data) {
      setMemberForm((prev) => ({
        ...prev,
        member_name: data.name || prev.member_name,
        member_phone: normalized,
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
    loadLeads();
  }

  async function deleteMember(subId: string) {
    if (!confirm((t as any).organizerMembers?.confirmDeleteMember || 'Remover este membro?')) return;
    await supabase.from('member_subscriptions').delete().eq('id', subId);
    loadSubscriptions();
    loadLeads();
  }

  async function viewHistory(sub: Subscription) {
    const phone = sub.member_phone;
    if (!phone) return;

    const { data } = await supabase
      .from('players')
      .select('tournament_id, tournaments(name)')
      .eq('phone_number', phone);

    const tournaments = (data || []).map((p: any) => p.tournaments?.name).filter(Boolean);

    setHistoryPlayer({
      name: sub.member_name || phone,
      phone,
      tournaments,
    });
    setShowHistoryModal(true);
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
  }, [subscriptions, statusFilter, sortField, sortAsc]);

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
      <div className="flex items-center gap-4 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('plans')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'plans'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Award className="w-4 h-4 inline mr-2" />
          {(t as any).organizerMembers?.plans || 'Planos'}
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'members'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="w-4 h-4 inline mr-2" />
          {(t as any).organizerMembers?.members || 'Membros'}
        </button>
      </div>

      {activeTab === 'plans' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
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
          <div className="flex flex-wrap justify-between items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-800">
              {(t as any).organizerMembers?.manageMembers || 'Gerir Membros'}
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    statusFilter === 'all' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'
                  }`}
                >
                  {(t as any).organizerMembers?.all || 'Todos'}
                </button>
                <button
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    statusFilter === 'active' ? 'bg-white shadow-sm text-green-700' : 'text-gray-500'
                  }`}
                >
                  {(t as any).organizerMembers?.active || 'Ativos'}
                </button>
                <button
                  onClick={() => setStatusFilter('expired')}
                  className={`px-3 py-1 text-sm rounded-md transition-colors ${
                    statusFilter === 'expired' ? 'bg-white shadow-sm text-red-700' : 'text-gray-500'
                  }`}
                >
                  {(t as any).organizerMembers?.expired || 'Expirados'}
                </button>
              </div>
              <div className="relative group">
                <button className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
                  <Download className="w-4 h-4" />
                </button>
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 hidden group-hover:block z-10 min-w-[140px]">
                  <button onClick={exportCSV} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                    CSV
                  </button>
                  <button onClick={exportPhones} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                    <Phone className="w-3.5 h-3.5 inline mr-2" />
                    {(t as any).organizerMembers?.phoneList || 'Telefones'}
                  </button>
                  <button onClick={exportEmails} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">
                    <Mail className="w-3.5 h-3.5 inline mr-2" />
                    Emails
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(true)}
                className="flex items-center gap-2 px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Importar
              </button>
              <button
                onClick={() => openMemberModal()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                {(t as any).organizerMembers?.addMember || 'Adicionar'}
              </button>
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
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
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
            </div>
          )}

          {leads.length > 0 && (
            <div className="mt-8 space-y-3">
              <h3 className="text-md font-semibold text-gray-700 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-yellow-500" />
                {(t as any).organizerMembers?.leads || 'Leads'} ({leads.length})
              </h3>
              <p className="text-sm text-gray-500">
                {(t as any).organizerMembers?.leadsDescription || 'Jogadores dos seus torneios que ainda não são membros'}
              </p>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">
                          {(t as any).organizerMembers?.name || 'Nome'}
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">
                          {(t as any).organizerMembers?.phone || 'Telefone'}
                        </th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">
                          {(t as any).organizerMembers?.tournament || 'Torneio'}
                        </th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {leads.slice(0, 20).map((lead, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-800">{lead.name}</td>
                          <td className="px-4 py-3 text-gray-600">{lead.phone_number}</td>
                          <td className="px-4 py-3 text-gray-600">{lead.tournament_name}</td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => {
                                setMemberForm({
                                  member_phone: lead.phone_number,
                                  member_name: lead.name,
                                  member_email: '',
                                  plan_id: plans[0]?.id || '',
                                  amount_paid: 0,
                                  notes: '',
                                  status: 'active',
                                  start_date: new Date().toISOString().split('T')[0],
                                });
                                setEditingSubscription(null);
                                setShowMemberModal(true);
                              }}
                              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                            >
                              <Plus className="w-3.5 h-3.5 inline mr-1" />
                              {(t as any).organizerMembers?.addAsMember || 'Adicionar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
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
              <div className="grid grid-cols-2 gap-3">
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
              <div className="grid grid-cols-2 gap-3">
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
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
              {historyPlayer.tournaments.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  {(t as any).organizerMembers?.noHistory || 'Sem participações registadas'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {historyPlayer.tournaments.map((name, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-700 py-2 px-3 bg-gray-50 rounded-lg">
                      <Medal className="w-4 h-4 text-blue-500 shrink-0" />
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      <ImportContactsModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImported={() => {
          loadLeads();
          loadSubscriptions();
        }}
      />
    </div>
  );
}
