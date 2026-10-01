import { useEffect, useMemo, useState } from 'react';
import { Calendar, Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ClubLeagueTeam, Tournament } from '../lib/supabase';
import {
  assignMatchdayDates,
  expectedMatchdayCount,
  generateClubLeagueSchedule,
} from '../lib/clubLeagueScheduler';

type MatchdayInput = {
  number: number;
  date: string;
  time: string;
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
    return Array.from({ length: matchdayCount }, (_, i) => ({
      number: i + 1,
      date: dates[i] || start,
      time: baseTime,
      leg: i < roundsPerLeg ? 'home' : 'away',
    }));
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
    const first = rows[0];
    if (!first?.date) return;
    const dates = assignMatchdayDates(rows.length, first.date, 7);
    setRows(prev =>
      prev.map((r, i) => ({
        ...r,
        date: dates[i] || r.date,
        time: first.time || r.time,
      }))
    );
  };

  const generate = async () => {
    if (teams.length < 2) {
      setError('São necessários pelo menos 2 clubes.');
      return;
    }
    for (const r of rows) {
      if (!r.date || !r.time) {
        setError(`Preencha data e hora da Jornada ${r.number}.`);
        return;
      }
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

      const schedule = generateClubLeagueSchedule(teams.map(t => t.id));
      const teamById = new Map(teams.map(t => [t.id, t]));
      const mdByNumber = new Map<number, string>();

      for (const row of rows) {
        const legFromSchedule =
          schedule.find(s => s.matchdayNumber === row.number)?.leg || row.leg;
        const { data: md, error: mdErr } = await supabase
          .from('club_league_matchdays')
          .insert({
            tournament_id: tournament.id,
            category_id: categoryId,
            matchday_number: row.number,
            matchday_date: row.date,
            label: `Jornada ${row.number}`,
            leg: legFromSchedule,
          })
          .select('id, matchday_number')
          .single();
        if (mdErr) throw mdErr;
        mdByNumber.set(row.number, md.id);
      }

      const timeByNumber = new Map(rows.map(r => [r.number, r]));
      const inserts = schedule.map(s => {
        const home = teamById.get(s.homeTeamId);
        const row = timeByNumber.get(s.matchdayNumber);
        const date = row?.date;
        const time = row?.time || baseTime;
        const timeFull = time.length === 5 ? `${time}:00` : time;
        return {
          tournament_id: tournament.id,
          category_id: categoryId,
          matchday_id: mdByNumber.get(s.matchdayNumber) || null,
          home_team_id: s.homeTeamId,
          away_team_id: s.awayTeamId,
          scheduled_time: date ? `${date}T${timeFull}` : null,
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Definir calendário
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {teams.length} clubes · {matchdayCount} jornadas (ida + volta)
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <p className="text-sm text-gray-600">
            Introduz a data e hora de cada jornada. O sistema atribui automaticamente os confrontos
            com <strong>casa / fora</strong> (cada clube joga em casa e fora contra todos).
          </p>

          <button
            type="button"
            onClick={applyWeeklyFromFirst}
            className="text-xs text-emerald-700 hover:underline"
          >
            Preencher semanalmente a partir da 1ª jornada
          </button>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}

          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div
                key={row.number}
                className="border rounded-lg p-3 grid grid-cols-[auto_1fr_1fr] gap-2 items-center"
              >
                <div className="pr-1">
                  <p className="text-sm font-semibold whitespace-nowrap">J{row.number}</p>
                  <p className="text-[10px] text-gray-500 uppercase">
                    {row.number <= roundsPerLeg ? 'ida' : 'volta'}
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Data</label>
                  <input
                    type="date"
                    value={row.date}
                    onChange={e => updateRow(idx, { date: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-0.5">Hora</label>
                  <input
                    type="time"
                    value={row.time}
                    onChange={e => updateRow(idx, { time: e.target.value })}
                    className="w-full border rounded-lg px-2 py-1.5 text-sm"
                  />
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
