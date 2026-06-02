export interface GeocodingResult {
  lat: number;
  lng: number;
  displayName: string;
}

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'PadelOne/1.0';

/**
 * Geocode an address string to lat/lng coordinates using Nominatim.
 * Free, no API key needed. Rate-limited to 1 request/second.
 * Returns null if no results found.
 */
export async function geocodeAddress(address: string): Promise<GeocodingResult | null> {
  try {
    const params = new URLSearchParams({
      q: address,
      format: 'json',
      limit: '1',
    });

    const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) return null;

    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    const result = data[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
    };
  } catch {
    return null;
  }
}

/**
 * Reverse geocode coordinates to an address string.
 * Returns null if no results found.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lng.toString(),
      format: 'json',
    });

    const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params}`, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!response.ok) return null;

    const data = await response.json();

    return data.display_name ?? null;
  } catch {
    return null;
  }
}
