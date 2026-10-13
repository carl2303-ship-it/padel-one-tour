import { useMemo, useState } from 'react';
import { Calendar, Loader2, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type {
  ClubLeagueConfrontation,
  ClubLeagueMatchday,
  ClubLeagueTeam,
  Tournament,
} from '../lib/supabase';
import {
  addDaysIso,
  assignMatchdayDates,
  expectedMatchdayCount,
  formatEuDate,
  generateClubLeagueSchedule,
  homeWeekdayLabel,
  normalizeHomeTime,
  parseEuDate,
  parseEuTime,
  scheduledTimeForHomeGame,
} from '../lib/clubLeagueScheduler';
import MiniMonthDatePicker from './MiniMonthDatePicker';

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
  existingMatchdays: ClubLeagueMatchday[];
  existingConfrontations: ClubLeagueConfrontation[];
  onClose: () => void;
  onSuccess: () => void;
};

function defaultTime(tournament: Tournament): string {
  const raw = tournament.daily_start_time || tournament.start_time || '18:00';
  return raw.length >= 5 ? raw.slice(0, 5) : '18:00';
}

function buildInitialRows(params: {
  matchdayCount: number;
  roundsPerLeg: number;
  baseTime: string;
  startDate: string;
  existingMatchdays: ClubLeagueMatchday[];
}): MatchdayInput[] {
  const { matchdayCount, roundsPerLeg, baseTime, startDate, existingMatchdays } = params;
  const byNumber = new Map(existingMatchdays.map(md => [md.matchday_number, md]));

  if (existingMatchdays.length > 0) {
    return Array.from({ length: matchdayCount }, (_, i) => {
      const number = i + 1;
      const md = byNumber.get(number);
      const day1Iso = md?.matchday_date || addDaysIso(startDate, (number - 1) * 7);
      const day2Iso = md?.matchday_date_2 || addDaysIso(day1Iso, 1);
      return {
        number,
        day1: formatEuDate(day1Iso),
        day2: formatEuDate(day2Iso),
        defaultTime: baseTime,
        leg: (md?.leg as 'home' | 'away') || (i < roundsPerLeg ? 'home' : 'away'),
      };
    });
  }

  const dates = assignMatchdayDates(matchdayCount, startDate, 7);
  return Array.from({ length: matchdayCount }, (_, i) => {
    const day1Iso = dates[i] || startDate;
    return {
      number: i + 1,
      day1: formatEuDate(day1Iso),
      day2: formatEuDate(addDaysIso(day1Iso, 1)),
      defaultTime: baseTime,
      leg: i < roundsPerLeg ? 'home' : 'away',
    };
  });
}

export default function ClubLeagueScheduleModal({
  tournament,
  teams,
  categoryId,
  existingMatchdays,
  existingConfrontations,
  onClose,
  onSuccess,
}: Props) {
  const matchdayCount = expectedMatchdayCount(teams.length);
  const roundsPerLeg = matchdayCount / 2;
  const baseTime = defaultTime(tournament);
  const startDate = tournament.start_date || new Date().toISOString().slice(0, 10);
  const hasExistingCalendar =
    existingConfrontations.length > 0 || existingMatchdays.length > 0;

  // Init once from existing calendar (not tournament.start_date every render)
  const [rows, setRows] = useState<MatchdayInput[]>(() =>
    buildInitialRows({
      matchdayCount,
      roundsPerLeg,
      baseTime,
      startDate,
      existingMatchdays,
    })
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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

  const teamsMissingHomeSlot = useMemo(
    () =>
      teams.filter(
        t =>
          t.home_weekday == null ||
          t.home_weekday < 1 ||
          t.home_weekday > 7 ||
          !normalizeHomeTime(t.home_time)
      ),
    [teams]
  );

  const parseRows = () => {
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
        setError(`Data de referência inválida na Jornada ${r.number} (usa dd/MM/aaaa).`);
        return null;
      }
      let day2Iso: string | null = null;
      if (r.day2.trim()) {
        day2Iso = parseEuDate(r.day2);
        if (!day2Iso) {
          setError(`Data do dia 2 inválida na Jornada ${r.number} (usa dd/MM/aaaa).`);
          return null;
        }
      }
      const fallbackTime = parseEuTime(r.defaultTime) || baseTime;
      parsed.push({
        number: r.number,
        day1Iso,
        day2Iso,
        time: fallbackTime,
        leg: r.leg,
      });
    }
    return parsed;
  };

  /** Update only matchday weeks + each game's scheduled_time (keeps pairings). */
  const saveDatesOnly = async () => {
    if (!hasExistingCalendar) {
      setError('Ainda não há calendário. Usa “Gerar confrontos”.');
      return;
    }
    if (teamsMissingHomeSlot.length > 0) {
      setError(
        `Define dia e hora em casa em todos os clubes. Em falta: ${teamsMissingHomeSlot
          .map(t => t.name)
          .join(', ')}.`
      );
      return;
    }

    const parsed = parseRows();
    if (!parsed) return;

    setBusy(true);
    setError('');
    try {
      const teamById = new Map(teams.map(t => [t.id, t]));
      const mdByNumber = new Map(existingMatchdays.map(md => [md.matchday_number, md]));

      for (const row of parsed) {
        const md = mdByNumber.get(row.number);
        if (!md) continue;

        const mdGames = existingConfrontations.filter(c => c.matchday_id === md.id);
        const slots = mdGames.map(c => {
          const home = c.home_team_id ? teamById.get(c.home_team_id) : null;
          return scheduledTimeForHomeGame({
            weekRefIso: row.day1Iso,
            defaultTime: row.time,
            homeWeekday: home?.home_weekday,
            homeTime: home?.home_time,
          });
        });

        const dates = [...new Set(slots.map(s => s.dateIso))].sort();
        const matchdayDate = dates[0] || row.day1Iso;
        const matchdayDate2 =
          dates.length > 1
            ? dates[dates.length - 1]
            : row.day2Iso && row.day2Iso !== matchdayDate
              ? row.day2Iso
              : null;

        const { error: mdErr } = await supabase
          .from('club_league_matchdays')
          .update({
            matchday_date: matchdayDate,
            matchday_date_2: matchdayDate2 && matchdayDate2 !== matchdayDate ? matchdayDate2 : null,
          })
          .eq('id', md.id);
        if (mdErr) throw mdErr;

        for (let i = 0; i < mdGames.length; i++) {
          const c = mdGames[i];
          const slot = slots[i];
          const { error: confErr } = await supabase
            .from('club_league_confrontations')
            .update({ scheduled_time: slot.scheduledTime })
            .eq('id', c.id);
          if (confErr) throw confErr;
        }
      }

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar datas');
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (teams.length < 2) {
      setError('São necessários pelo menos 2 clubes.');
      return;
    }

    if (teamsMissingHomeSlot.length > 0) {
      setError(
        `Define dia e hora em casa em todos os clubes antes de gerar. Em falta: ${teamsMissingHomeSlot
          .map(t => t.name)
          .join(', ')}.`
      );
      return;
    }

    const parsed = parseRows();
    if (!parsed) return;

    if (hasExistingCalendar) {
      if (
        !confirm(
          'Já existe calendário. Regenerar apaga jornadas, confrontos e lineups. Continuar?'
        )
      ) {
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
      const { error: delConfErr } = await delConf;
      if (delConfErr) throw delConfErr;

      let delMd = supabase
        .from('club_league_matchdays')
        .delete()
        .eq('tournament_id', tournament.id);
      delMd = categoryId ? delMd.eq('category_id', categoryId) : delMd.is('category_id', null);
      const { error: delMdErr } = await delMd;
      if (delMdErr) throw delMdErr;

      const orderedTeams = [...teams].sort(
        (a, b) => (a.registration_order || 0) - (b.registration_order || 0)
      );
      const schedule = generateClubLeagueSchedule(
        orderedTeams.map(t => ({
          id: t.id,
          name: t.name,
          clubId: t.club_id,
        }))
      );
      const teamById = new Map(orderedTeams.map(t => [t.id, t]));
      const mdByNumber = new Map<number, string>();
      const metaByNumber = new Map(parsed.map(r => [r.number, r]));

      const gameSlots = schedule.map(s => {
        const home = teamById.get(s.homeTeamId);
        const meta = metaByNumber.get(s.matchdayNumber)!;
        const slot = scheduledTimeForHomeGame({
          weekRefIso: meta.day1Iso,
          defaultTime: meta.time,
          homeWeekday: home?.home_weekday,
          homeTime: home?.home_time,
        });
        return { ...s, home, slot };
      });

      for (const row of parsed) {
        const legFromSchedule =
          schedule.find(s => s.matchdayNumber === row.number)?.leg || row.leg;
        const mdGames = gameSlots.filter(g => g.matchdayNumber === row.number);
        const dates = [...new Set(mdGames.map(g => g.slot.dateIso))].sort();
        const matchdayDate = dates[0] || row.day1Iso;
        const matchdayDate2 =
          dates.length > 1 ? dates[dates.length - 1] : row.day2Iso;

        const { data: md, error: mdErr } = await supabase
          .from('club_league_matchdays')
          .insert({
            tournament_id: tournament.id,
            category_id: categoryId,
            matchday_number: row.number,
            matchday_date: matchdayDate,
            matchday_date_2: matchdayDate2 && matchdayDate2 !== matchdayDate ? matchdayDate2 : null,
            label: `Jornada ${row.number}`,
            leg: legFromSchedule,
          })
          .select('id, matchday_number')
          .single();
        if (mdErr) throw mdErr;
        mdByNumber.set(row.number, md.id);
      }

      const inserts = gameSlots.map(g => ({
        tournament_id: tournament.id,
        category_id: categoryId,
        matchday_id: mdByNumber.get(g.matchdayNumber) || null,
        home_team_id: g.homeTeamId,
        away_team_id: g.awayTeamId,
        scheduled_time: g.slot.scheduledTime,
        venue: g.home?.name || null,
        status: 'scheduled',
      }));

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
              {hasExistingCalendar ? 'Editar datas do calendário' : 'Definir calendário'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {teams.length} clubes · {matchdayCount} jornadas (ida + volta) · escolhe no calendário
              {hasExistingCalendar ? ' · a carregar datas já gravadas' : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          <p className="text-sm text-gray-600">
            Cada jornada = uma semana de referência. Cada jogo usa o <strong>dia e hora em casa</strong> do
            anfitrião. {hasExistingCalendar ? (
              <>
                Para <strong>só mudar datas</strong>, edita abaixo e usa “Guardar datas” (mantém os
                confrontos). Regenerar apaga tudo.
              </>
            ) : (
              <>
                Na volta inverte-se casa/fora. No máximo{' '}
                <strong>1 equipa em casa por clube</strong> por jornada.
              </>
            )}
          </p>

          <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-xs text-emerald-900 space-y-1">
            <p className="font-medium">Slots em casa dos clubes</p>
            {teams.length === 0 ? (
              <p>Sem clubes inscritos.</p>
            ) : (
              <ul className="space-y-0.5">
                {teams.map(t => (
                  <li key={t.id}>
                    <strong>{t.name}</strong>:{' '}
                    {t.home_weekday != null && normalizeHomeTime(t.home_time)
                      ? `${homeWeekdayLabel(t.home_weekday)} · ${normalizeHomeTime(t.home_time)}`
                      : '⚠️ falta dia/hora — edita o clube'}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={applyWeeklyFromFirst}
            className="text-xs text-emerald-700 hover:underline"
          >
            Preencher semanas (+7 dias) a partir da 1ª jornada
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <MiniMonthDatePicker
                    label="Semana de referência"
                    hint="Qualquer dia dessa semana — os jogos caem no dia em casa de cada clube."
                    value={row.day1}
                    onChange={(eu, iso) =>
                      updateRow(idx, {
                        day1: eu,
                        day2: iso ? formatEuDate(addDaysIso(iso, 1)) : row.day2,
                      })
                    }
                  />
                  <MiniMonthDatePicker
                    label="Dia 2"
                    optional
                    hint="Só referência (opcional)."
                    value={row.day2}
                    onChange={(eu) => updateRow(idx, { day2: eu })}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t flex flex-wrap gap-2 justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
          >
            Cancelar
          </button>
          {hasExistingCalendar && (
            <button
              type="button"
              disabled={busy || teams.length < 2}
              onClick={saveDatesOnly}
              className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-50 inline-flex items-center gap-2"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar datas
            </button>
          )}
          <button
            type="button"
            disabled={busy || teams.length < 2}
            onClick={generate}
            className={`px-4 py-2 text-sm rounded-lg disabled:opacity-50 inline-flex items-center gap-2 ${
              hasExistingCalendar
                ? 'border border-amber-300 text-amber-900 bg-amber-50 hover:bg-amber-100'
                : 'bg-emerald-600 text-white'
            }`}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calendar className="w-4 h-4" />}
            {hasExistingCalendar ? 'Regenerar confrontos' : 'Gerar confrontos casa/fora'}
          </button>
        </div>
      </div>
    </div>
  );
}
