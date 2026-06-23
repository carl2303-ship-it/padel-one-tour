import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsHeaders,
  extractBookingId,
  firstName,
  jsonResponse,
  mapPadel1HttpError,
  padel1Fetch,
  Padel1ConfigError,
  parsePadel1Json,
  validateIsoDate,
} from "../_shared/padel1.ts";

interface CreateBookingRequest {
  court_id?: string;
  start_time?: string;
  end_time?: string;
  player_name?: string;
  player_phone?: string;
}

function validateCreateBooking(body: CreateBookingRequest): string | null {
  if (!body.court_id?.trim()) return "court_id es obligatorio";
  if (!body.start_time?.trim()) return "start_time es obligatorio";
  if (!body.end_time?.trim()) return "end_time es obligatorio";
  if (!body.player_name?.trim()) return "player_name es obligatorio";

  const startError = validateIsoDate(body.start_time, "start_time");
  if (startError) return startError;

  const endError = validateIsoDate(body.end_time, "end_time");
  if (endError) return endError;

  const start = new Date(body.start_time);
  const end = new Date(body.end_time);
  if (end <= start) return "end_time debe ser posterior a start_time";

  return null;
}

function buildPadel1BookingPayload(body: CreateBookingRequest) {
  const name = firstName(body.player_name!.trim());
  const phone = body.player_phone?.trim() || null;

  return {
    court_id: body.court_id!.trim(),
    start_time: body.start_time,
    end_time: body.end_time,
    booked_by_name: name,
    booked_by_phone: phone,
    player1_name: name,
    player1_phone: phone,
    status: "confirmed",
    event_type: "match",
    payment_status: "pending",
    notes: "Reserva creada via agente IA",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Método no permitido" }, 405);
  }

  try {
    const body = (await req.json()) as CreateBookingRequest;
    const validationError = validateCreateBooking(body);
    if (validationError) {
      return jsonResponse({ success: false, error: validationError }, 400);
    }

    const payload = buildPadel1BookingPayload(body);
    const response = await padel1Fetch("/bookings", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const data = await parsePadel1Json(response);

    if (!response.ok) {
      const mapped = mapPadel1HttpError(response.status, data);
      return jsonResponse({ success: false, error: mapped.message }, mapped.status);
    }

    const record = (typeof data === "object" && data)
      ? data as Record<string, unknown>
      : {};
    const bookingId = extractBookingId(record);

    if (!bookingId) {
      return jsonResponse(
        {
          success: false,
          error: "Padel1 no devolvió un ID de reserva",
        },
        502,
      );
    }

    return jsonResponse(
      {
        success: true,
        booking_id: bookingId,
        message: "Reserva creada correctamente",
      },
      201,
    );
  } catch (error) {
    if (error instanceof Padel1ConfigError) {
      return jsonResponse({ success: false, error: error.message }, 500);
    }

    return jsonResponse(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Error inesperado al crear la reserva",
      },
      500,
    );
  }
});
