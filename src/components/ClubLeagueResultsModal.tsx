import { useEffect, useState } from 'react';
import { X, Save, Loader2, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ClubLeagueConfrontation, ClubLeagueTeam } from '../lib/supabase';
import { duoMatchSets, buildStandingsFromResults } from '../lib/clubLeagueStandings';

type Props = {
  confrontation: ClubLeagueConfrontation;
  homeTeam: ClubLeagueTeam | null | undefined;
  awayTeam: ClubLeagueTeam | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
};

type DuoScores = {
  homeSet1: number | '';
  awaySet1: number | '';
  homeSet2: number | '';
  awaySet2: number | '';
  homeStb: number | '';
  awayStb: number | '';
};

const emptyDuo = (): DuoScores => ({
  homeSet1: '',
  awaySet1: '',
  homeSet2: '',
  awaySet2: '',
  homeStb: '',
  awayStb: '',
});

function needsStb(d: DuoScores): boolean {
  if (d.homeSet1 === '' || d.awaySet1 === '' || d.homeSet2 === '' || d.awaySet2 === '') return false;
  let h = 0;
  let a = 0;
  if (Number(d.homeSet1) > Number(d.awaySet1)) h++;
  else if (Number(d.awaySet1) > Number(d.homeSet1)) a++;
  if (Number(d.homeSet2) > Number(d.awaySet2)) h++;
  else if (Number(d.awaySet2) > Number(d.homeSet2)) a++;
  return h === 1 && a === 1;
}

export default function ClubLeagueResultsModal({
  confrontation,
  homeTeam,
  awayTeam,
  onClose,
  onSuccess,
}: Props) {
  const [duo1, setDuo1] = useState<DuoScores>(emptyDuo());
  const [duo2, setDuo2] = useState<DuoScores>(emptyDuo());
  const [duo3, setDuo3] = useState<DuoScores>(emptyDuo());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: existing } = await supabase
        .from('club_league_games')
        .select('*')
        .eq('confrontation_id', confrontation.id);

      if (!existing || existing.length === 0) {
        await supabase.from('club_league_games').insert([
          { confrontation_id: confrontation.id, game_type: 'duo1', game_order: 1 },
          { confrontation_id: confrontation.id, game_type: 'duo2', game_order: 2 },
          { confrontation_id: confrontation.id, game_type: 'duo3', game_order: 3 },
        ]);
      } else {
        const apply = (g: Record<string, unknown>, setter: (d: DuoScores) => void) => {
          setter({
            homeSet1: (g.home_set1 as number | null) ?? '',
            awaySet1: (g.away_set1 as number | null) ?? '',
            homeSet2: (g.home_set2 as number | null) ?? '',
            awaySet2: (g.away_set2 as number | null) ?? '',
            homeStb: (g.home_stb as number | null) ?? '',
            awayStb: (g.away_stb as number | null) ?? '',
          });
        };
        existing.forEach(g => {
          if (g.game_type === 'duo1') apply(g, setDuo1);
          if (g.game_type === 'duo2') apply(g, setDuo2);
          if (g.game_type === 'duo3') apply(g, setDuo3);
        });
      }
      setLoading(false);
    };
    load();
  }, [confrontation.id]);

  const ScoreRow = ({
    label,
    scores,
    setScores,
  }: {
    label: string;
    scores: DuoScores;
    setScores: (d: DuoScores) => void;
  }) => {
    const stb = needsStb(scores);
    const num = (v: number | '', key: keyof DuoScores) => (
      <input
        type="number"
        min={0}
        value={v}
        onChange={e =>
          setScores({
            ...scores,
            [key]: e.target.value === '' ? '' : Number(e.target.value),
          })
        }
        className="w-14 border rounded px-2 py-1 text-center text-sm"
      />
    );
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="font-medium text-sm">{label}</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-16 text-gray-500">Set 1</span>
          {num(scores.homeSet1, 'homeSet1')}
          <span>-</span>
          {num(scores.awaySet1, 'awaySet1')}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-16 text-gray-500">Set 2</span>
          {num(scores.homeSet2, 'homeSet2')}
          <span>-</span>
          {num(scores.awaySet2, 'awaySet2')}
        </div>
        {stb && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-16 text-amber-700">Super TB</span>
            {num(scores.homeStb, 'homeStb')}
            <span>-</span>
            {num(scores.awayStb, 'awayStb')}
          </div>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    setError('');
    if (!homeTeam || !awayTeam) {
      setError('Equipas em falta');
      return;
    }

    const parseDuo = (d: DuoScores, label: string) => {
      if (d.homeSet1 === '' || d.awaySet1 === '' || d.homeSet2 === '' || d.awaySet2 === '') {
        throw new Error(`Preencha os 2 sets de ${label}`);
      }
      const stbNeeded = needsStb(d);
      if (stbNeeded && (d.homeStb === '' || d.awayStb === '')) {
        throw new Error(`Preencha o Super TB de ${label}`);
      }
      const result = duoMatchSets(
        Number(d.homeSet1),
        Number(d.awaySet1),
        Number(d.homeSet2),
        Number(d.awaySet2),
        stbNeeded ? Number(d.homeStb) : null,
        stbNeeded ? Number(d.awayStb) : null
      );
      if (!result.winner) throw new Error(`Resultado incompleto em ${label}`);
      return result;
    };

    setSaving(true);
    try {
      const r1 = parseDuo(duo1, 'Dupla 1');
      const r2 = parseDuo(duo2, 'Dupla 2');
      const r3 = parseDuo(duo3, 'Dupla 3');

      let homeDuos = 0;
      let awayDuos = 0;
      let homeSets = 0;
      let awaySets = 0;
      for (const r of [r1, r2, r3]) {
        homeSets += r.homeSets;
        awaySets += r.awaySets;
        if (r.winner === 'home') homeDuos++;
        else awayDuos++;
      }

      const winnerId = homeDuos > awayDuos ? homeTeam.id : awayTeam.id;

      const upsertGame = async (type: 'duo1' | 'duo2' | 'duo3', d: DuoScores, result: ReturnType<typeof duoMatchSets>) => {
        await supabase
          .from('club_league_games')
          .update({
            home_set1: Number(d.homeSet1),
            away_set1: Number(d.awaySet1),
            home_set2: Number(d.homeSet2),
            away_set2: Number(d.awaySet2),
            home_stb: needsStb(d) ? Number(d.homeStb) : null,
            away_stb: needsStb(d) ? Number(d.awayStb) : null,
            winner_team_id: result.winner === 'home' ? homeTeam.id : awayTeam.id,
            status: 'completed',
            updated_at: new Date().toISOString(),
          })
          .eq('confrontation_id', confrontation.id)
          .eq('game_type', type);
      };

      await upsertGame('duo1', duo1, r1);
      await upsertGame('duo2', duo2, r2);
      await upsertGame('duo3', duo3, r3);

      await supabase
        .from('club_league_confrontations')
        .update({
          home_duos_won: homeDuos,
          away_duos_won: awayDuos,
          home_sets_won: homeSets,
          away_sets_won: awaySets,
          winner_team_id: winnerId,
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', confrontation.id);

      // Recalculate standings for the tournament
      const { data: allTeams } = await supabase
        .from('club_league_teams')
        .select('id')
        .eq('tournament_id', confrontation.tournament_id);

      const { data: completed } = await supabase
        .from('club_league_confrontations')
        .select('home_team_id, away_team_id, winner_team_id, home_sets_won, away_sets_won')
        .eq('tournament_id', confrontation.tournament_id)
        .eq('status', 'completed');

      const teamIds = (allTeams || []).map(t => t.id);
      const results = (completed || [])
        .filter(c => c.home_team_id && c.away_team_id && c.winner_team_id)
        .map(c => ({
          homeTeamId: c.home_team_id as string,
          awayTeamId: c.away_team_id as string,
          winnerTeamId: c.winner_team_id as string,
          homeSetsWon: c.home_sets_won || 0,
          awaySetsWon: c.away_sets_won || 0,
        }));

      const ranked = buildStandingsFromResults(teamIds, results);
      for (const row of ranked) {
        await supabase
          .from('club_league_standings')
          .upsert(
            {
              tournament_id: confrontation.tournament_id,
              category_id: confrontation.category_id,
              team_id: row.teamId,
              played: row.played,
              won: row.won,
              lost: row.lost,
              sets_won: row.setsWon,
              sets_lost: row.setsLost,
              sets_diff: row.setsDiff,
              points: row.points,
              position: row.position,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'tournament_id,team_id' }
          );
      }

      onSuccess();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao guardar resultado');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              Resultado
            </h2>
            <p className="text-sm text-gray-600">
              {homeTeam?.name || 'Casa'} vs {awayTeam?.name || 'Fora'}
            </p>
            <p className="text-xs text-gray-400">Melhor de 2 sets + Super TB se 1-1</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded">{error}</div>}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 text-xs text-gray-500 px-1">
                <span>Casa: {homeTeam?.name}</span>
                <span className="text-right">Fora: {awayTeam?.name}</span>
              </div>
              <ScoreRow label="Dupla 1" scores={duo1} setScores={setDuo1} />
              <ScoreRow label="Dupla 2" scores={duo2} setScores={setDuo2} />
              <ScoreRow label="Dupla 3" scores={duo3} setScores={setDuo3} />
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border">
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white flex items-center gap-2 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
