import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';

export type OrganizerVenue = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  club_id: string | null;
  courts: Array<{ id: string; name: string; is_active: boolean }>;
};

type DirectoryClub = {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  owner_id: string | null;
};

type Props = {
  userId: string;
  /** Selected venue ids */
  selectedVenueIds: string[];
  onChangeVenues: (venueIds: string[]) => void;
  /** Selected court names (flat list for tournament.court_names) */
  selectedCourtNames: string[];
  onChangeCourts: (courtNames: string[]) => void;
  /** Hide court pickers (e.g. club league — calendar has no court grid) */
  hideCourts?: boolean;
};

type VenueForm = {
  name: string;
  city: string;
  address: string;
  courtsText: string; // one court per line
};

const emptyForm = (): VenueForm => ({
  name: '',
  city: '',
  address: '',
  courtsText: 'Campo 1\nCampo 2',
});

export default function OrganizerVenuePicker({
  userId,
  selectedVenueIds,
  onChangeVenues,
  selectedCourtNames,
  onChangeCourts,
  hideCourts = false,
}: Props) {
  const [directoryClubs, setDirectoryClubs] = useState<DirectoryClub[]>([]);
  const [venues, setVenues] = useState<OrganizerVenue[]>([]);
  const [clubCourtNames, setClubCourtNames] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<VenueForm>(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [{ data: clubRows, error: clubErr }, { data: venueRows, error: vErr }] = await Promise.all([
        supabase
          .from('clubs')
          .select('id, name, city, address, owner_id')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('organizer_venues')
          .select('id, name, address, city, club_id')
          .eq('user_id', userId)
          .order('name'),
      ]);
      if (clubErr) throw clubErr;
      if (vErr) throw vErr;

      setDirectoryClubs(clubRows || []);

      const ids = (venueRows || []).map(v => v.id);
      let courtsByVenue = new Map<string, Array<{ id: string; name: string; is_active: boolean }>>();
      if (ids.length > 0) {
        const { data: courtRows, error: cErr } = await supabase
          .from('organizer_venue_courts')
          .select('id, venue_id, name, is_active, sort_order')
          .in('venue_id', ids)
          .order('sort_order');
        if (cErr) throw cErr;
        for (const c of courtRows || []) {
          const list = courtsByVenue.get(c.venue_id) || [];
          list.push({ id: c.id, name: c.name, is_active: c.is_active });
          courtsByVenue.set(c.venue_id, list);
        }
      }

      setVenues(
        (venueRows || []).map(v => ({
          ...v,
          courts: courtsByVenue.get(v.id) || [],
        }))
      );

      // Courts from managed clubs (club_courts via owner)
      const owners = [...new Set((clubRows || []).map(c => c.owner_id).filter(Boolean))] as string[];
      const courtMap = new Map<string, string[]>();
      if (owners.length > 0) {
        const { data: ownedCourts } = await supabase
          .from('club_courts')
          .select('user_id, name, is_active')
          .in('user_id', owners)
          .eq('is_active', true)
          .order('sort_order');
        const byOwner = new Map<string, string[]>();
        for (const c of ownedCourts || []) {
          const list = byOwner.get(c.user_id) || [];
          if (c.name?.trim()) list.push(c.name.trim());
          byOwner.set(c.user_id, list);
        }
        for (const club of clubRows || []) {
          if (!club.owner_id) continue;
          courtMap.set(club.id, byOwner.get(club.owner_id) || []);
        }
      }
      setClubCourtNames(courtMap);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar clubes');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const venueByClubId = useMemo(() => {
    const map = new Map<string, OrganizerVenue>();
    for (const v of venues) {
      if (v.club_id) map.set(v.club_id, v);
    }
    return map;
  }, [venues]);

  const selectedVenues = useMemo(
    () => venues.filter(v => selectedVenueIds.includes(v.id)),
    [venues, selectedVenueIds]
  );

  const availableCourts = useMemo(() => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const v of selectedVenues) {
      for (const c of v.courts) {
        if (!c.is_active) continue;
        const key = c.name.trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        names.push(key);
      }
      if (v.club_id) {
        for (const n of clubCourtNames.get(v.club_id) || []) {
          if (!n || seen.has(n)) continue;
          seen.add(n);
          names.push(n);
        }
      }
    }
    return names;
  }, [selectedVenues, clubCourtNames]);

  // Drop selected courts that no longer belong to selected venues
  useEffect(() => {
    if (selectedCourtNames.length === 0) return;
    const allowed = new Set(availableCourts);
    const next = selectedCourtNames.filter(n => allowed.has(n));
    if (next.length !== selectedCourtNames.length) {
      onChangeCourts(next);
    }
  }, [availableCourts, selectedCourtNames, onChangeCourts]);

  const filteredClubs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return directoryClubs;
    return directoryClubs.filter(
      c =>
        c.name.toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q)
    );
  }, [directoryClubs, search]);

  const ensureVenueForClub = async (club: DirectoryClub): Promise<string> => {
    const existing = venueByClubId.get(club.id);
    if (existing) return existing.id;

    const { data: venueRow, error: venueErr } = await supabase
      .from('organizer_venues')
      .insert({
        user_id: userId,
        club_id: club.id,
        name: club.name,
        city: club.city,
        address: club.address,
      })
      .select('id')
      .single();
    if (venueErr) throw venueErr;

    // Seed courts from club_courts when available; otherwise leave empty for later edit
    const seedCourts = clubCourtNames.get(club.id) || [];
    if (seedCourts.length > 0) {
      await supabase.from('organizer_venue_courts').insert(
        seedCourts.map((cn, i) => ({
          venue_id: venueRow.id,
          name: cn,
          sort_order: i,
          is_active: true,
        }))
      );
    }

    return venueRow.id;
  };

  const toggleClub = async (club: DirectoryClub) => {
    setBusy(true);
    setError('');
    try {
      const existing = venueByClubId.get(club.id);
      if (existing && selectedVenueIds.includes(existing.id)) {
        onChangeVenues(selectedVenueIds.filter(id => id !== existing.id));
        return;
      }

      const venueId = existing?.id || (await ensureVenueForClub(club));
      if (!existing) await load();
      if (!selectedVenueIds.includes(venueId)) {
        onChangeVenues([...selectedVenueIds, venueId]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao selecionar clube');
    } finally {
      setBusy(false);
    }
  };

  const toggleCourt = (name: string) => {
    if (selectedCourtNames.includes(name)) {
      onChangeCourts(selectedCourtNames.filter(n => n !== name));
    } else {
      onChangeCourts([...selectedCourtNames, name]);
    }
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
    setError('');
  };

  const openEdit = (venue: OrganizerVenue) => {
    setEditingId(venue.id);
    setForm({
      name: venue.name,
      city: venue.city || '',
      address: venue.address || '',
      courtsText: venue.courts.map(c => c.name).join('\n') || 'Campo 1',
    });
    setShowForm(true);
    setError('');
  };

  const parseCourtNames = (text: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const line of text.split('\n')) {
      const n = line.trim();
      if (!n || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
    }
    return out;
  };

  const saveVenue = async () => {
    const name = form.name.trim();
    if (!name) {
      setError('Indica o nome do clube.');
      return;
    }
    const courtNames = parseCourtNames(form.courtsText);
    if (courtNames.length === 0 && !hideCourts) {
      setError('Indica pelo menos um campo.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      if (editingId) {
        const venue = venues.find(v => v.id === editingId);
        const { error: updErr } = await supabase
          .from('organizer_venues')
          .update({
            name,
            city: form.city.trim() || null,
            address: form.address.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingId)
          .eq('user_id', userId);
        if (updErr) throw updErr;

        // Only update directory club row if it has no owner (organizer-created)
        if (venue?.club_id) {
          const dir = directoryClubs.find(c => c.id === venue.club_id);
          if (dir && !dir.owner_id) {
            await supabase
              .from('clubs')
              .update({
                name,
                city: form.city.trim() || null,
                address: form.address.trim() || null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', venue.club_id);
          }
        }

        await supabase.from('organizer_venue_courts').delete().eq('venue_id', editingId);
        if (courtNames.length > 0) {
          const { error: insCourtsErr } = await supabase.from('organizer_venue_courts').insert(
            courtNames.map((cn, i) => ({
              venue_id: editingId,
              name: cn,
              sort_order: i,
              is_active: true,
            }))
          );
          if (insCourtsErr) throw insCourtsErr;
        }
      } else {
        // Directory club (no owner) so App.tsx does not treat organizer as club owner
        const { data: clubRow, error: clubErr } = await supabase
          .from('clubs')
          .insert({
            name,
            city: form.city.trim() || null,
            address: form.address.trim() || null,
            owner_id: null,
            is_active: true,
            is_managed: false,
            status: 'active',
            plan_type: 'preview',
          })
          .select('id')
          .single();
        if (clubErr) throw clubErr;

        const { data: venueRow, error: venueErr } = await supabase
          .from('organizer_venues')
          .insert({
            user_id: userId,
            club_id: clubRow.id,
            name,
            city: form.city.trim() || null,
            address: form.address.trim() || null,
          })
          .select('id')
          .single();
        if (venueErr) throw venueErr;

        if (courtNames.length > 0) {
          const { error: courtsErr } = await supabase.from('organizer_venue_courts').insert(
            courtNames.map((cn, i) => ({
              venue_id: venueRow.id,
              name: cn,
              sort_order: i,
              is_active: true,
            }))
          );
          if (courtsErr) throw courtsErr;
        }

        onChangeVenues([...selectedVenueIds, venueRow.id]);
      }

      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm());
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar clube');
    } finally {
      setBusy(false);
    }
  };

  const unlinkVenue = async (venue: OrganizerVenue) => {
    if (!confirm(`Remover "${venue.name}" da tua lista de clubes?`)) return;
    setBusy(true);
    setError('');
    try {
      const { error: delErr } = await supabase
        .from('organizer_venues')
        .delete()
        .eq('id', venue.id)
        .eq('user_id', userId);
      if (delErr) throw delErr;
      onChangeVenues(selectedVenueIds.filter(id => id !== venue.id));
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao remover clube');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
        <Loader2 className="w-4 h-4 animate-spin" /> A carregar clubes do Padel1…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-800">Clubes do universo Padel1</p>
          <p className="text-xs text-gray-500">
            Seleciona um ou mais clubes já registados. Podes também adicionar um clube novo.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" /> Novo clube
        </button>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Pesquisar clube ou cidade…"
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {error && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {filteredClubs.length === 0 ? (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-3">
          {search.trim()
            ? 'Nenhum clube corresponde à pesquisa. Cria um novo com o botão acima.'
            : 'Ainda não há clubes ativos no Padel1. Cria o primeiro com Novo clube.'}
        </p>
      ) : (
        <div className="border border-gray-200 rounded-lg divide-y max-h-72 overflow-y-auto bg-white">
          {filteredClubs.map(club => {
            const venue = venueByClubId.get(club.id);
            const selected = !!(venue && selectedVenueIds.includes(venue.id));
            const courtCount =
              (venue?.courts.filter(c => c.is_active).length || 0) ||
              (clubCourtNames.get(club.id)?.length || 0);
            return (
              <div
                key={club.id}
                className={`flex items-start gap-3 p-3 ${selected ? 'bg-blue-50' : ''}`}
              >
                <input
                  type="checkbox"
                  className="mt-1 w-4 h-4 text-blue-600 rounded"
                  checked={selected}
                  disabled={busy}
                  onChange={() => toggleClub(club)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{club.name}</p>
                  <p className="text-xs text-gray-500">
                    {[club.city, club.address].filter(Boolean).join(' · ') || 'Sem morada'}
                    {' · '}
                    {courtCount} campo(s)
                    {club.owner_id ? '' : ' · diretório'}
                  </p>
                </div>
                {venue && (
                  <>
                    <button
                      type="button"
                      onClick={() => openEdit(venue)}
                      className="p-1.5 text-gray-500 hover:bg-white rounded-lg"
                      title="Editar campos"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => unlinkVenue(venue)}
                      disabled={busy}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg"
                      title="Remover da minha lista"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-green-700 font-medium">
        {selectedVenueIds.length} clube(s) selecionado(s) · {directoryClubs.length} no Padel1
      </p>

      {selectedVenueIds.length > 0 && !hideCourts && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-700">Campos do torneio</label>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className="text-blue-600 hover:underline"
                onClick={() => onChangeCourts([...availableCourts])}
              >
                Selecionar todos
              </button>
              <button
                type="button"
                className="text-gray-600 hover:underline"
                onClick={() => onChangeCourts([])}
              >
                Limpar
              </button>
            </div>
          </div>
          {availableCourts.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
              Os clubes selecionados não têm campos. Edita o clube (lápis) e adiciona nomes de campos.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {availableCourts.map(name => (
                <label
                  key={name}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-sm ${
                    selectedCourtNames.includes(name)
                      ? 'bg-blue-100 border-2 border-blue-400'
                      : 'bg-white border border-gray-200'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-blue-600 rounded"
                    checked={selectedCourtNames.includes(name)}
                    onChange={() => toggleCourt(name)}
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-green-700 mt-2 font-medium">
            {selectedCourtNames.length} campo(s) selecionado(s) · {selectedVenueIds.length} clube(s)
          </p>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">
                {editingId ? 'Editar clube / campos' : 'Novo clube'}
              </h3>
              <button type="button" onClick={() => setShowForm(false)} className="p-1 hover:bg-gray-100 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Nome do clube *</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Ex: Padel Blu"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Cidade</label>
                <input
                  value={form.city}
                  onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Morada</label>
                <input
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Nomes dos campos (um por linha){hideCourts ? '' : ' *'}
              </label>
              <textarea
                value={form.courtsText}
                onChange={e => setForm(f => ({ ...f, courtsText: e.target.value }))}
                rows={4}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                placeholder={'Campo 1\nCampo 2\nCampo Central'}
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-2 text-sm border rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={saveVenue}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Resolve club UUIDs from selected organizer venues (for tournaments.club_ids). */
export async function clubIdsFromOrganizerVenues(venueIds: string[]): Promise<string[]> {
  if (venueIds.length === 0) return [];
  const { data } = await supabase
    .from('organizer_venues')
    .select('club_id')
    .in('id', venueIds);
  return [...new Set((data || []).map(r => r.club_id).filter(Boolean))] as string[];
}
