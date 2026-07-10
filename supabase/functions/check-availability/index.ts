import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  jsonResponse,
  mapPadel1HttpError,
  normalizeBookingsList,
  padel1Fetch,
  Padel1ConfigError,
  parsePadel1Json,
  validateIsoDate,
} from "../_shared/padel1.ts";
import { assertClubModule, resolveClubIdFromCourt } from "../_shared/modules.ts";

interface CheckAvailabilityRequest {
  court_id?: string;
  club_id?: string;
  date_from?: string;
  date_to?: string;
}

function validateAvailabilityRequest(body: CheckAvailabilityRequest): string | null {
  if (!body.court_id?.trim()) return "court_id es obligatorio";
  if (!body.date_from?.trim()) return "date_from es obligatorio";
  if (!body.date_to?.trim()) return "date_to es obligatorio";

  const fromError = validateIsoDate(body.date_from, "date_from");
  if (fromError) return fromError;

  const toError = validateIsoDate(body.date_to, "date_to");
  if (toError) return toError;

  const from = new Date(body.date_from);
  const to = new Date(body.date_to);
  if (to < from) return "date_to debe ser posterior o igual a date_from";

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Método no permitido" }, 405);
  }

  try {
    const body = (await req.json()) as CheckAvailabilityRequest;
    const validationError = validateAvailabilityRequest(body);
    if (validationError) {
      return jsonResponse({ success: false, error: validationError }, 400);
    }

    const clubId = body.club_id?.trim() ||
      await resolveClubIdFromCourt(body.court_id!.trim());
    if (!clubId) {
      return jsonResponse({ success: false, error: "club_id no encontrado para court_id" }, 400);
    }
    for (const mod of ["manager", "ai_full"] as const) {
      const modError = await assertClubModule(clubId, mod);
      if (modError) return jsonResponse({ success: false, error: modError }, 403);
    }

    const params = new URLSearchParams({
      court_id: body.court_id!.trim(),
      date_from: body.date_from!,
      date_to: body.date_to!,
    });

    const response = await padel1Fetch(`/bookings?${params.toString()}`, {
      method: "GET",
    });
    const data = await parsePadel1Json(response);

    if (!response.ok) {
      const mapped = mapPadel1HttpError(response.status, data);
      return jsonResponse({ success: false, error: mapped.message }, mapped.status);
    }

    const occupiedSlots = normalizeBookingsList(data);

    return jsonResponse({
      success: true,
      court_id: body.court_id!.trim(),
      date_from: body.date_from,
      date_to: body.date_to,
      occupied_slots: occupiedSlots,
      total_occupied: occupiedSlots.length,
    });
  } catch (error) {
    if (error instanceof Padel1ConfigError) {
      return jsonResponse({ success: false, error: error.message }, 500);
    }

    return jsonResponse(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Error inesperado al consultar disponibilidad",
      },
      500,
    );
  }
});
