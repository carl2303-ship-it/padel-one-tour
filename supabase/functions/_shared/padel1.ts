export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

export class Padel1ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Padel1ConfigError";
  }
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function getPadel1Config(): { endpoint: string; apiKey: string } {
  const endpoint = Deno.env.get("PADEL1_ENDPOINT")?.replace(/\/$/, "");
  const apiKey = Deno.env.get("PADEL1_AGENT_KEY");

  if (!endpoint || !apiKey) {
    throw new Padel1ConfigError(
      "PADEL1_ENDPOINT o PADEL1_AGENT_KEY no están configurados",
    );
  }

  return { endpoint, apiKey };
}

export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return trimmed;
  return trimmed.split(/\s+/)[0];
}

export function validateIsoDate(value: string, field: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return `${field} debe ser una fecha ISO 8601 válida`;
  }
  return null;
}

export async function padel1Fetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const { endpoint, apiKey } = getPadel1Config();
  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const url = path.startsWith("http") ? path : `${endpoint}${path}`;
  return fetch(url, { ...options, headers });
}

export async function parsePadel1Json(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export function extractBookingId(data: Record<string, unknown>): string | null {
  if (typeof data.booking_id === "string") return data.booking_id;
  if (typeof data.id === "string") return data.id;
  if (data.booking && typeof data.booking === "object") {
    const booking = data.booking as Record<string, unknown>;
    if (typeof booking.id === "string") return booking.id;
    if (typeof booking.booking_id === "string") return booking.booking_id;
  }
  return null;
}

export function extractErrorMessage(
  data: unknown,
  fallback: string,
): string {
  if (!data || typeof data !== "object") return fallback;
  const record = data as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  if (typeof record.message === "string") return record.message;
  return fallback;
}

export function mapPadel1HttpError(
  status: number,
  data: unknown,
): { message: string; status: number } {
  if (status === 400) {
    return {
      status: 400,
      message: extractErrorMessage(data, "Solicitud inválida"),
    };
  }
  if (status === 409) {
    return {
      status: 409,
      message: extractErrorMessage(
        data,
        "La pista no está disponible en ese horario",
      ),
    };
  }
  if (status === 404) {
    return {
      status: 404,
      message: extractErrorMessage(data, "Recurso no encontrado"),
    };
  }
  if (status >= 500) {
    return {
      status: 502,
      message: extractErrorMessage(data, "Error interno en Padel1"),
    };
  }
  return {
    status,
    message: extractErrorMessage(data, `Error de Padel1 (${status})`),
  };
}

export interface OccupiedSlot {
  booking_id: string | null;
  start_time: string;
  end_time: string;
  booked_by_name?: string | null;
}

export function normalizeBookingsList(data: unknown): OccupiedSlot[] {
  if (!data) return [];

  let bookings: unknown[] = [];
  if (Array.isArray(data)) {
    bookings = data;
  } else if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.bookings)) bookings = record.bookings;
    else if (Array.isArray(record.data)) bookings = record.data;
  }

  return bookings
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const booking = item as Record<string, unknown>;
      const start = booking.start_time;
      const end = booking.end_time;
      if (typeof start !== "string" || typeof end !== "string") return null;
      return {
        booking_id: typeof booking.id === "string"
          ? booking.id
          : typeof booking.booking_id === "string"
          ? booking.booking_id
          : null,
        start_time: start,
        end_time: end,
        booked_by_name: typeof booking.booked_by_name === "string"
          ? booking.booked_by_name
          : null,
      } satisfies OccupiedSlot;
    })
    .filter((slot): slot is OccupiedSlot => slot !== null);
}
