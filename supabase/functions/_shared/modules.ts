import { createClient } from "npm:@supabase/supabase-js@2";

export function getServiceSupabase() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Supabase service role not configured");
  return createClient(url, key);
}

export async function assertClubModule(
  clubId: string,
  moduleCode: string,
): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.rpc("has_module", {
    p_entity_type: "club",
    p_entity_id: clubId,
    p_module_code: moduleCode,
  });
  if (error) return `Module check failed: ${error.message}`;
  if (!data) return `Module '${moduleCode}' is not active for this club`;
  return null;
}

export async function resolveClubIdFromCourt(
  courtId: string,
): Promise<string | null> {
  const supabase = getServiceSupabase();
  const { data } = await supabase
    .from("club_courts")
    .select("club_id")
    .eq("id", courtId)
    .maybeSingle();
  return data?.club_id ?? null;
}
