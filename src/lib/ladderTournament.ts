/** Torneio Escada: regras de desafio e reordenação (rank 1 = topo). */

export type LadderPosition = { rank: number; team_id: string }

export type LadderChallenge = {
  id: string
  challenger_team_id: string
  challenged_team_id: string
  challenger_rank: number
  challenged_rank: number
  created_at: string
  deadline_at: string
  status: 'pending' | 'completed' | 'cancelled'
  winner_team_id?: string | null
}

export type LadderRow = {
  tournament_id: string
  category_id: string
  challenge_limit: number
  challenge_window_days: number
  positions: LadderPosition[] | unknown
  pending_challenges: LadderChallenge[] | unknown
  ladder_status: 'setup' | 'active' | 'completed' | 'cancelled'
  updated_at?: string
}

export function parsePositions(raw: unknown): LadderPosition[] {
  if (!Array.isArray(raw)) return []
  const out: LadderPosition[] = []
  for (const row of raw) {
    if (row && typeof row === 'object') {
      const r = row as Record<string, unknown>
      const teamId = (r.team_id ?? r.team) as string | undefined
      const rank = Number(r.rank ?? r.pos)
      if (teamId && Number.isFinite(rank)) out.push({ rank, team_id: teamId })
    }
  }
  return out.sort((a, b) => a.rank - b.rank)
}

/**
 * Classificação mostrada na app: inclui equipas inscritas depois da publicação da escada
 * (ainda não presentes em `positions`) no fundo, para aparecerem na lista e terem rank para desafios.
 */
export function mergePublishedPositionsWithTeams(
  rawPositions: unknown,
  teamIdsInDisplayOrder: string[],
  ladderStatus: string | undefined
): LadderPosition[] {
  const pos = parsePositions(rawPositions)
  const activeLike = ladderStatus === 'active' || ladderStatus === 'completed'
  if (!activeLike) {
    if (pos.length > 0) return normalizePositions(pos)
    return normalizePositions(teamIdsInDisplayOrder.map((id, i) => ({ rank: i + 1, team_id: id })))
  }
  const seen = new Set(pos.map((p) => p.team_id))
  const merged = [...pos]
  let maxR = pos.length ? Math.max(...pos.map((p) => p.rank)) : 0
  for (const tid of teamIdsInDisplayOrder) {
    if (!seen.has(tid)) {
      maxR += 1
      merged.push({ rank: maxR, team_id: tid })
      seen.add(tid)
    }
  }
  return normalizePositions(merged)
}

export function normalizePositions(positions: LadderPosition[]): LadderPosition[] {
  const sorted = [...positions].sort((a, b) => a.rank - b.rank)
  return sorted.map((p, i) => ({ rank: i + 1, team_id: p.team_id }))
}

/** Desafiado está acima = rank menor. Gap = challenger_rank - challenged_rank. */
export function validateChallenge(
  challengerRank: number,
  challengedRank: number,
  challengeLimit: number
): boolean {
  if (challengedRank >= challengerRank) return false
  const gap = challengerRank - challengedRank
  return gap >= 1 && gap <= challengeLimit
}

export function reorderAfterChallengerWin(
  positions: LadderPosition[],
  challengerTeamId: string,
  challengedTeamId: string
): LadderPosition[] {
  const arr = normalizePositions(parsePositions(positions))
  const i = arr.findIndex((p) => p.team_id === challengerTeamId)
  const j = arr.findIndex((p) => p.team_id === challengedTeamId)
  if (i < 0 || j < 0 || j >= i) return arr
  const [moved] = arr.splice(i, 1)
  arr.splice(j, 0, moved)
  return normalizePositions(arr)
}

export function teamHasOpenChallenge(
  pending: LadderChallenge[],
  teamId: string
): boolean {
  return pending.some(
    (c) =>
      c.status === 'pending' &&
      (c.challenger_team_id === teamId || c.challenged_team_id === teamId)
  )
}

export function parsePending(raw: unknown): LadderChallenge[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is LadderChallenge => {
    if (!c || typeof c !== 'object') return false
    const o = c as Record<string, unknown>
    return typeof o.id === 'string' && typeof o.challenger_team_id === 'string' && o.status === 'pending'
  }) as LadderChallenge[]
}
