import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Auth users that own a club, have an organizer record, or are super-admins
 * must never be linked to player_accounts or have their password reset by
 * player-auth helpers. Doing so silently overwrites the organizer login.
 */
export async function isProtectedAuthUser(
  supabaseAdmin: SupabaseClient,
  userId: string | null | undefined,
): Promise<{ protected: boolean; reason?: string }> {
  if (!userId) return { protected: false };

  const [{ data: club }, { data: organizer }, { data: superAdmin }] =
    await Promise.all([
      supabaseAdmin
        .from("clubs")
        .select("id, name")
        .eq("owner_id", userId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("organizers")
        .select("id, email")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("super_admins")
        .select("id")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
    ]);

  if (club) {
    return {
      protected: true,
      reason: `Auth user owns club ${club.name || club.id}`,
    };
  }
  if (organizer) {
    return {
      protected: true,
      reason: `Auth user is organizer ${organizer.email || organizer.id}`,
    };
  }
  if (superAdmin) {
    return { protected: true, reason: "Auth user is a super admin" };
  }

  return { protected: false };
}
