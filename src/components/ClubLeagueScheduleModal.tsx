import { useEffect, useMemo, useState } from 'react';
import { Calendar, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ClubLeagueTeam, Tournament } from '../lib/supabase';
import {
  addDaysIso,
  assignMatchdayDates,
  expectedMatchdayCount,
  formatEuDate,
  generateClubLeagueSchedule,
  parseEuDate,
  parseEuTime,
} from '../lib/clubLeagueScheduler';

type MatchdayInput = {
  number: number;
  day1: string; // dd/MM/yyyy display
  day2: string; // dd/MM/yyyy display (optional)
  defaultTime: string; // HH:mm 24h
  leg: 'home' | 'away';
};

type Props = {
  tournament: Tournament;
  teams: ClubLeagueTeam[];
  categoryId: string | null;
  hasExistingCalendar: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function defaultTime(tournament: Tournament): string {
  const raw = tournament.daily_start_time || tournament.start_time || '18:00';
  return raw.length >= 5 ? raw.slice(0, 5) : '18:00';
}

export default function ClubLeagueScheduleModal({
  tournament,
  teams,
  categoryId,
  hasExistingCalendar,
  onClose,
  onSuccess,
}: Props) {
  const matchdayCount = expectedMatchdayCount(teams.length);
  const roundsPerLeg = matchdayCount / 2;
  const baseTime = defaultTime(tournament);

  const initialRows = useMemo((): MatchdayInput[] => {
    const start = tournament.start_date || new Date().toISOString().slice(0, 10);
    const dates = assignMatchdayDates(matchdayCount, start, 7);
    return Array.from({ length: matchdayCount }, (_, i) => {
      const day1Iso = dates[i] || start;
      return {
        number: i + 1,
        day1: formatEuDate(day1Iso),
        day2: formatEuDate(addDaysIso(day1Iso, 1)),
        defaultTime: baseTime,
        leg: i < roundsPerLeg ? 'home' : 'away',
      };
    });
  }, [matchdayCount, roundsPerLeg, tournament.start_date, baseTime]);

  const [rows, setRows] = useState<MatchdayInput[]>(initialRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  const updateRow = (index: number, patch: Partial<MatchdayInput>) => {
    setRows(prev => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const applyWeeklyFromFirst = () => {
    const firstIso = parseEuDate(rows[0]?.day1);
    if (!firstIso) {
      setError('Data do dia 1 da Jornada 1 inválida (usa dd/MM/aaaa).');
      return;
    }
    const dates = assignMatchdayDates(rows.length, firstIso, 7);
    const time = rows[0]?.defaultTime || baseTime;
    setRows(prev =>
      prev.map((r, i) => {
        const d1 = dates[i] || firstIso;
        return {
          ...r,
          day1: formatEuDate(d1),
          day2: formatEuDate(addDaysIso(d1, 1)),
          defaultTime: time,
        };
      })
    );
    setError('');
  };

  const generate = async () => {
    if (teams.length < 2) {
      setError('São necessários pelo menos 2 clubes.');
      return;
    }

    const parsed: {
      number: number;
      day1Iso: string;
      day2Iso: string | null;
      time: string;
      leg: 'home' | 'away';
    }[] = [];

    for (const r of rows) {
      const day1Iso = parseEuDate(r.day1);
      if (!day1Iso) {
        setError(`Data do dia 1 inválida na Jornada ${r.number} (usa dd/MM/aaaa).`);
        return;
      }
      let day2Iso: string | null = null;
      if (r.day2.trim()) {
        day2Iso = parseEuDate(r.day2);
        if (!day2Iso) {
          setError(`Data do dia 2 inválida na Jornada ${r.number} (usa dd/MM/aaaa).`);
          return;
        }
      }
      if (!r.defaultTime || !parseEuTime(r.defaultTime)) {
        setError(`Hora inválida na Jornada ${r.number} (usa HH:mm em 24h, ex: 18:30).`);
        return;
      }
      parsed.push({
        number: r.number,
        day1Iso,
        day2Iso,
        time: parseEuTime(r.defaultTime),
        leg: r.leg,
      });
    }

    if (hasExistingCalendar) {
      if (!confirm('Já existe calendário. Regenerar apaga jornadas e confrontos. Continuar?')) {
        return;
      }
    }

    setBusy(true);
    setError('');
    try {
      let delConf = supabase
        .from('club_league_confrontations')
        .delete()
        .eq('tournament_id', tournament.id);
      delConf = categoryId ? delConf.eq('category_id', categoryId) : delConf.is('category_id', null);
      await delConf;

      let delMd = supabase
        .from('club_league_matchdays')
        .delete()
        .eq('tournament_id', tournament.id);
      delMd = categoryId ? delMd.eq('category_id', categoryId) : delMd.is('category_id', null);
      await delMd;

      // Ordenar clubes por registration_order para resultado estável
      const orderedTeams = [...teams].sort(
        (a, b) => (a.registration_order || 0) - (b.registration_order || 0)
      );
      const schedule = generateClubLeagueSchedule(orderedTeams.map(t => t.id));
      const teamById = new Map(orderedTeams.map(t => [t.id, t]));
      const mdByNumber = new Map<number, string>();
      const metaByNumber = new Map(parsed.map(r => [r.number, r]));

      for (const row of parsed) {
        const legFromSchedule =
          schedule.find(s => s.matchdayNumber === row.number)?.leg || row.leg;
        const { data: md, error: mdErr } = await supabase
          .from('club_league_matchdays')
          .insert({
            tournament_id: tournament.id,
            category_id: categoryId,
            matchday_number: row.number,
            matchday_date: row.day1Iso,
            matchday_date_2: row.day2Iso,
            label: `Jornada ${row.number}`,
            leg: legFromSchedule,
          })
          .select('id, matchday_number')
          .single();
        if (mdErr) throw mdErr;
        mdByNumber.set(row.number, md.id);
      }

      // Dentro de cada jornada, escalonar horas (+90 min) se vários jogos no mesmo dia
      const slotIndexByMd = new Map<number, number>();
      const inserts = schedule.map(s => {
        const home = teamById.get(s.homeTeamId);
        const meta = metaByNumber.get(s.matchdayNumber);
        const day = meta?.day1Iso;
        const base = meta?.time || baseTime;
        const slot = slotIndexByMd.get(s.matchdayNumber) || 0;
        slotIndexByMd.set(s.matchdayNumber, slot + 1);

        let hour = Number(base.slice(0, 2));
        let minute = Number(base.slice(3, 5));
        minute += slot * 90;
        hour += Math.floor(minute / 60);
        minute = minute % 60;
        hour = hour % 24;
        const timeFull = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;

        return {
          tournament_id: tournament.id,
          category_id: categoryId,
          matchday_id: mdByNumber.get(s.matchdayNumber) || null,
          home_team_id: s.homeTeamId,
          away_team_id: s.awayTeamId,
          scheduled_time: day ? `${day}T${timeFull}` : null,
          venue: home?.name || null,
          status: 'scheduled',
        };
      });

      const { error: insErr } = await supabase.from('club_league_confrontations').insert(inserts);
      if (insErr) throw insErr;

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao gerar calendário');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Definir calendário
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {teams.length} clubes · {matchdayCount} jornadas (ida + volta) · datas dd/MM/aaaa · hora 24h
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <p className="text-sm text-gray-600">
            Cada jornada pode ter <strong>2 dias</strong>. O sistema gera os confrontos casa/fora
            equilibrados; depois podes definir o dia e a hora de cada jogo no calendário.
          </p>

          <button
            type="button"
            onClick={applyWeeklyFromFirst}
            className="text-xs text-emerald-700 hover:underline"
          >
            Preencher semanalmente (dia 1 + dia 2) a partir da 1ª jornada
          </button>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}

          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={row.number} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    Jornada {row.number}{' '}
                    <span className="text-[10px] font-normal text-gray-500 uppercase">
                      {row.number <= roundsPerLeg ? 'ida' : 'volta'}
                    </span>
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Dia 1 (dd/MM/aaaa)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="23/10/2026"
                      value={row.day1}
                      onChange={e => updateRow(idx, { day1: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">
                      Dia 2 (opcional)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="24/10/2026"
                      value={row.day2}
                      onChange={e => updateRow(idx, { day2: e.target.value })}
                      className="w-full border rounded-lg px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-0.5">Hora base 24h (HH:mm)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="18:00"
                      value={row.defaultTime}
                      onChange={e => updateRow(idx, { defaultTime: e.target.value })}
                      onBlur={e => {
                        const parsed = parseEuTime(e.target.value);
                        if (parsed) updateRow(idx, { defaultTime: parsed });
                      }}
                      className="w-full border rounded-lg px-2 py-1.5 text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t flex gap-2 justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || teams.length < 2}
            onClick={generate}
            className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            Gerar confrontos casa/fora
          </button>
        </div>
      </div>
    </div>
  );
}
