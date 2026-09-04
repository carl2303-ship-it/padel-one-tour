import { supabase } from './supabase';

/** Split large `.in(ids)` PostgREST filters to avoid URL/RLS timeouts. */
export async function selectInChunks<T>(
  table: string,
  select: string,
  column: string,
  ids: string[],
  chunkSize = 25
): Promise<T[]> {
  if (ids.length === 0) return [];
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase.from(table).select(select).in(column, chunk);
    if (error) {
      console.error(`[selectInChunks] ${table}.${column}:`, error.message);
      continue;
    }
    if (data) rows.push(...(data as T[]));
  }
  return rows;
}
