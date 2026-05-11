import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, Tournament } from '../lib/supabase'
import { useI18n } from '../lib/i18nContext'
import { useAuth } from '../lib/authContext'
import { ArrowLeft, ChevronDown, ChevronUp, Plus } from 'lucide-react'
import AddTeamModal from './AddTeamModal'
import {
  LadderRow,
  parsePositions,
  normalizePositions,
  validateChallenge,
  reorderAfterChallengerWin,
  parsePending,
  teamHasOpenChallenge,
  type LadderChallenge,
  type LadderPosition,
} from '../lib/ladderTournament'

type TeamRow = {
  id: string
  name: string
  player1_id: string
  player2_id: string
  player1?: { id: string; name: string; user_id?: string | null }
  player2?: { id: string; name: string; user_id?: string | null }
}

export default function LadderTournamentView({
  tournament,
  onBack,
}: {
  tournament: Tournament
  onBack: () => void
}) {
  const { t } = useI18n()
  const { user } = useAuth()
  const L = t.ladder

  const [loading, setLoading] = useState(true)
  const [ladder, setLadder] = useState<LadderRow | null>(null)
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [orderedTeamIds, setOrderedTeamIds] = useState<string[]>([])
  const [showAddTeam, setShowAddTeam] = useState(false)
  const [limitEdit, setLimitEdit] = useState(5)
  const [resultModal, setResultModal] = useState<LadderChallenge | null>(null)
  const [busy, setBusy] = useState(false)

  const isOrganizer = Boolean(user?.id && tournament.user_id === user.id)

  const load = useCallback(async () => {
    setLoading(true)
    const [ladderRes, teamsRes] = await Promise.all([
      supabase.from('ladder_tournaments').select('*').eq('tournament_id', tournament.id).maybeSingle(),
      supabase
        .from('teams')
        .select(
          'id, name, player1_id, player2_id, player1:players!teams_player1_id_fkey(id, name, user_id), player2:players!teams_player2_id_fkey(id, name, user_id)'
        )
        .eq('tournament_id', tournament.id)
        .order('seed', { ascending: true }),
    ])
    if (ladderRes.data) {
      const row = ladderRes.data as LadderRow
      setLadder(row)
      setLimitEdit(row.challenge_limit)
    } else {
      setLadder(null)
    }
    const tl = (teamsRes.data || []) as TeamRow[]
    setTeams(tl)

    const positions = parsePositions(ladderRes.data?.positions)
    if (positions.length > 0) {
      setOrderedTeamIds(positions.map((p) => p.team_id))
    } else {
      setOrderedTeamIds(tl.map((x) => x.id))
    }
    setLoading(false)
  }, [tournament.id])

  useEffect(() => {
    void load()
  }, [load])

  const myPlayerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const tm of teams) {
      if (tm.player1?.user_id === user?.id) ids.add(tm.player1_id)
      if (tm.player2?.user_id === user?.id) ids.add(tm.player2_id)
    }
    return ids
  }, [teams, user?.id])

  const myTeamIds = useMemo(() => {
    return new Set(
      teams.filter((t) => myPlayerIds.has(t.player1_id) || myPlayerIds.has(t.player2_id)).map((t) => t.id)
    )
  }, [teams, myPlayerIds])

  const positions = useMemo(() => parsePositions(ladder?.positions), [ladder?.positions])
  const pending = useMemo(() => parsePending(ladder?.pending_challenges), [ladder?.pending_challenges])

  const teamById = useMemo(() => new Map(teams.map((x) => [x.id, x])), [teams])

  const rankByTeamId = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of positions) m.set(p.team_id, p.rank)
    return m
  }, [positions])

  const orderedRows = useMemo(() => {
    if (ladder?.ladder_status === 'setup' && isOrganizer) {
      return orderedTeamIds.map((id, i) => ({ rank: i + 1, team_id: id }))
    }
    return positions.length > 0 ? positions : orderedTeamIds.map((id, i) => ({ rank: i + 1, team_id: id }))
  }, [ladder?.ladder_status, isOrganizer, orderedTeamIds, positions])

  const moveSetup = (index: number, dir: -1 | 1) => {
    setOrderedTeamIds((prev) => {
      const j = index + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[j]] = [next[j], next[index]]
      return next
    })
  }

  const publishLadder = async () => {
    if (!ladder || !isOrganizer) return
    setBusy(true)
    const pos: LadderPosition[] = normalizePositions(
      orderedTeamIds.map((team_id, i) => ({ rank: i + 1, team_id }))
    )
    const { error } = await supabase
      .from('ladder_tournaments')
      .update({
        positions: pos,
        ladder_status: 'active',
        pending_challenges: [],
      })
      .eq('tournament_id', tournament.id)
    setBusy(false)
    if (error) {
      alert(L.errorGeneric + ': ' + error.message)
      return
    }
    await supabase.from('tournaments').update({ status: 'active' }).eq('id', tournament.id)
    await load()
  }

  const syncNewTeamsToBottom = async () => {
    if (!ladder || !isOrganizer) return
    setBusy(true)
    const existing = new Set(parsePositions(ladder.positions).map((p) => p.team_id))
    const missing = teams.map((x) => x.id).filter((id) => !existing.has(id))
    if (missing.length === 0) {
      setBusy(false)
      return
    }
    const base = parsePositions(ladder.positions)
    const maxR = base.length ? Math.max(...base.map((p) => p.rank)) : 0
    const appended = [
      ...base,
      ...missing.map((team_id, i) => ({ rank: maxR + i + 1, team_id })),
    ]
    const pos = normalizePositions(appended)
    const { error } = await supabase.from('ladder_tournaments').update({ positions: pos }).eq('tournament_id', tournament.id)
    setBusy(false)
    if (error) alert(L.errorGeneric + ': ' + error.message)
    else void load()
  }

  const saveChallengeLimit = async () => {
    if (!ladder || !isOrganizer) return
    setBusy(true)
    const { error } = await supabase
      .from('ladder_tournaments')
      .update({ challenge_limit: Math.min(50, Math.max(1, limitEdit)) })
      .eq('tournament_id', tournament.id)
    setBusy(false)
    if (error) alert(L.errorGeneric + ': ' + error.message)
    else void load()
  }

  const createChallenge = async (challengedTeamId: string, challengedRank: number) => {
    if (!ladder || ladder.ladder_status !== 'active') {
      alert(L.mustPublishFirst)
      return
    }
    const challengerTeamId = [...myTeamIds][0]
    if (!challengerTeamId) return
    const challengerRank = rankByTeamId.get(challengerTeamId)
    if (challengerRank == null) return
    if (!validateChallenge(challengerRank, challengedRank, ladder.challenge_limit)) return

    const allPending = parsePending(ladder.pending_challenges)
    if (teamHasOpenChallenge(allPending, challengerTeamId) || teamHasOpenChallenge(allPending, challengedTeamId)) {
      alert(L.alreadyPending)
      return
    }

    const now = new Date()
    const deadline = new Date(now.getTime() + ladder.challenge_window_days * 86400000)
    const ch: LadderChallenge = {
      id: crypto.randomUUID(),
      challenger_team_id: challengerTeamId,
      challenged_team_id: challengedTeamId,
      challenger_rank: challengerRank,
      challenged_rank: challengedRank,
      created_at: now.toISOString(),
      deadline_at: deadline.toISOString(),
      status: 'pending',
    }
    const next = [...allPending, ch]
    setBusy(true)
    const { error } = await supabase
      .from('ladder_tournaments')
      .update({ pending_challenges: next })
      .eq('tournament_id', tournament.id)
    setBusy(false)
    if (error) alert(L.errorGeneric + ': ' + error.message)
    else {
      alert(L.challengeCreated)
      void load()
    }
  }

  const submitChallengeResult = async (winnerTeamId: string) => {
    if (!ladder || !resultModal) return
    const all = (Array.isArray(ladder.pending_challenges) ? ladder.pending_challenges : []) as LadderChallenge[]
    const updated = all.map((c) =>
      c.id === resultModal.id
        ? { ...c, status: 'completed' as const, winner_team_id: winnerTeamId }
        : c
    )
    let newPositions = parsePositions(ladder.positions)
    if (winnerTeamId === resultModal.challenger_team_id) {
      newPositions = reorderAfterChallengerWin(
        newPositions,
        resultModal.challenger_team_id,
        resultModal.challenged_team_id
      )
    }
    setBusy(true)
    const { error } = await supabase
      .from('ladder_tournaments')
      .update({
        pending_challenges: updated.filter((c) => c.status === 'pending'),
        positions: newPositions,
      })
      .eq('tournament_id', tournament.id)
    setBusy(false)
    setResultModal(null)
    if (error) alert(L.errorGeneric + ': ' + error.message)
    else void load()
  }

  const initLadderRow = async () => {
    if (!isOrganizer) return
    setBusy(true)
    const { error } = await supabase.from('ladder_tournaments').insert({
      tournament_id: tournament.id,
      challenge_limit: 5,
      challenge_window_days: 7,
      positions: [],
      pending_challenges: [],
      ladder_status: 'setup',
    })
    setBusy(false)
    if (error) alert(L.errorGeneric + ': ' + error.message)
    else void load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!ladder) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-8 text-center space-y-4">
        <p className="text-gray-700">Ladder: sem dados. Aplique a migration ou inicialize.</p>
        {isOrganizer && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void initLadderRow()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg"
          >
            Inicializar escada
          </button>
        )}
        <button type="button" onClick={onBack} className="block mx-auto text-sm text-gray-500 underline">
          Voltar
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-lg p-6">
        <div className="flex items-start gap-4">
          <button type="button" onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-900">{tournament.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {t.format?.ladder ?? 'Ladder'} · {ladder.ladder_status === 'active' ? L.ladderActive : L.ladderSetup}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAddTeam(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            {L.addTeam}
          </button>
        </div>

        {isOrganizer && (
          <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-100 space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm font-medium text-gray-700">
                {L.challengeLimitEdit}
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="ml-2 border rounded px-2 py-1 w-20"
                  value={limitEdit}
                  onChange={(e) => setLimitEdit(Number(e.target.value))}
                />
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveChallengeLimit()}
                className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded-lg"
              >
                {L.saveLimit}
              </button>
            </div>
            <p className="text-xs text-gray-600">{t.tournament.ladderChallengeLimitHelp}</p>
          </div>
        )}
      </div>

      {ladder.ladder_status === 'setup' && !isOrganizer && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-amber-900 text-sm">{L.ladderSetup}</div>
      )}

      {ladder.ladder_status === 'setup' && isOrganizer && (
        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <h3 className="font-semibold text-gray-900">{L.setupTitle}</h3>
          <p className="text-sm text-gray-600">{L.setupHint}</p>
          <ul className="divide-y border rounded-lg">
            {orderedTeamIds.map((tid, idx) => {
              const tm = teamById.get(tid)
              return (
                <li key={tid} className="flex items-center justify-between gap-2 p-3">
                  <span className="text-gray-500 w-8">{idx + 1}</span>
                  <span className="flex-1 font-medium text-gray-900">
                    {tm?.name ?? tid}
                    {tm && (
                      <span className="block text-xs text-gray-500 font-normal">
                        {(tm.player1?.name || '?') + ' / ' + (tm.player2?.name || '?')}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="p-2 rounded border hover:bg-gray-50"
                      onClick={() => moveSetup(idx, -1)}
                      aria-label="up"
                    >
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      className="p-2 rounded border hover:bg-gray-50"
                      onClick={() => moveSetup(idx, 1)}
                      aria-label="down"
                    >
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            disabled={busy || orderedTeamIds.length < 2}
            onClick={() => void publishLadder()}
            className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium disabled:opacity-50"
          >
            {L.publish}
          </button>
        </div>
      )}

      {(ladder.ladder_status === 'active' || (!isOrganizer && positions.length > 0)) && (
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">{L.title}</h3>
            {isOrganizer && ladder.ladder_status === 'active' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void syncNewTeamsToBottom()}
                className="text-sm text-blue-600 underline"
              >
                {L.syncNewTeams}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-4">{L.rank}</th>
                  <th className="py-2 pr-4">{L.team}</th>
                  <th className="py-2">{myTeamIds.size ? L.challenge : ''}</th>
                </tr>
              </thead>
              <tbody>
                {orderedRows.map((row) => {
                  const tm = teamById.get(row.team_id)
                  const challengerTeamId = [...myTeamIds][0]
                  const myRank = challengerTeamId ? rankByTeamId.get(challengerTeamId) : undefined
                  const canShowChallenge =
                    ladder.ladder_status === 'active' &&
                    myTeamIds.size > 0 &&
                    challengerTeamId &&
                    row.team_id !== challengerTeamId &&
                    myRank != null &&
                    validateChallenge(myRank, row.rank, ladder.challenge_limit)
                  return (
                    <tr key={row.team_id} className="border-b border-gray-100">
                      <td className="py-2 pr-4 font-mono">{row.rank}</td>
                      <td className="py-2 pr-4">
                        <div className="font-medium text-gray-900">{tm?.name ?? row.team_id}</div>
                        <div className="text-xs text-gray-500">
                          {tm ? `${tm.player1?.name || '?'} / ${tm.player2?.name || '?'}` : ''}
                        </div>
                      </td>
                      <td className="py-2">
                        {canShowChallenge ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void createChallenge(row.team_id, row.rank)}
                            className="px-2 py-1 text-xs bg-orange-500 text-white rounded-md"
                          >
                            {L.challenge}
                          </button>
                        ) : (
                          <span className="text-gray-300">{L.notEligible}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pending.length > 0 && (
        <div className="bg-white rounded-xl shadow p-6 space-y-2">
          <h3 className="font-semibold text-gray-900">{L.pending}</h3>
          <ul className="space-y-2">
            {pending.map((c) => {
              const t1 = teamById.get(c.challenger_team_id)
              const t2 = teamById.get(c.challenged_team_id)
              const canRecord =
                isOrganizer ||
                myTeamIds.has(c.challenger_team_id) ||
                myTeamIds.has(c.challenged_team_id)
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                  <div>
                    <div className="text-sm">
                      <span className="font-medium">{t1?.name}</span> vs <span className="font-medium">{t2?.name}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {L.deadline}: {new Date(c.deadline_at).toLocaleString()}
                    </div>
                  </div>
                  {canRecord && (
                    <button
                      type="button"
                      onClick={() => setResultModal(c)}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg"
                    >
                      {L.recordResult}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {showAddTeam && (
        <AddTeamModal tournamentId={tournament.id} onClose={() => setShowAddTeam(false)} onSuccess={() => void load()} />
      )}

      {resultModal && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setResultModal(null)}
        >
          <div className="bg-white rounded-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h4 className="font-bold text-lg">{L.resultTitle}</h4>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitChallengeResult(resultModal.challenger_team_id)}
                className="py-2 px-3 rounded-lg bg-orange-100 text-orange-900 font-medium"
              >
                {L.challengerWon}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitChallengeResult(resultModal.challenged_team_id)}
                className="py-2 px-3 rounded-lg bg-slate-100 text-slate-900 font-medium"
              >
                {L.defenderWon}
              </button>
              <button type="button" onClick={() => setResultModal(null)} className="text-sm text-gray-500">
                {L.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
