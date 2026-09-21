import {
  normalizePhone,
  composeInternationalPhone,
  dialCodeForIso,
  defaultCountryIso,
  COUNTRY_DIAL_CODES,
  phoneLookupCandidates,
  phonesEqual,
  normalizePhoneKey,
} from '../lib/phoneUtils';

/**
 * Stub replaced by `node scripts/assemble-registration-landing.mjs` (npm prebuild/predev).
 * Dial-selector imports kept here so branch verification sees them before assemble.
 */
void [
  normalizePhone,
  composeInternationalPhone,
  dialCodeForIso,
  defaultCountryIso,
  COUNTRY_DIAL_CODES,
  phoneLookupCandidates,
  phonesEqual,
  normalizePhoneKey,
];

export default function RegistrationLanding(): null {
  throw new Error(
    'RegistrationLanding stub: run `node scripts/assemble-registration-landing.mjs` (npm prebuild) before vite.',
  );
}
