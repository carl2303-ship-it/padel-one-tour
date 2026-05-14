/** Normaliza `club_ids` (array JSON, string Postgres `{uuid,uuid}`) + `club_id` legacy. */
export function parseClubIds(clubIds: unknown, clubId?: string | null): string[] {
  const out: string[] = []
  const push = (id: string | null | undefined) => {
    if (id && typeof id === 'string' && !out.includes(id)) out.push(id)
  }
  if (clubIds == null) {
    push(clubId ?? undefined)
    return out
  }
  if (Array.isArray(clubIds)) {
    for (const x of clubIds) {
      if (typeof x === 'string') push(x)
    }
    if (out.length === 0) push(clubId ?? undefined)
    return out
  }
  if (typeof clubIds === 'string') {
    const s = clubIds.trim()
    if (s.startsWith('{') && s.endsWith('}')) {
      const inner = s.slice(1, -1).trim()
      if (inner.length > 0) {
        for (const part of inner.split(',')) {
          const id = part.trim().replace(/^"|"$/g, '')
          push(id || null)
        }
      }
    } else if (/^[0-9a-f-]{36}$/i.test(s)) {
      push(s)
    }
    if (out.length === 0) push(clubId ?? undefined)
    return out
  }
  push(clubId ?? undefined)
  return out
}
