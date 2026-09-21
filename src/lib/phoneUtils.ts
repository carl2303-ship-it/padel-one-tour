/** Phone storage: international format (E.164-like), e.g. +351912345678. */

export const MIN_PHONE_DIGITS = 6;
export const MAX_PHONE_DIGITS = 15;

export const COUNTRY_DIAL_CODES: { iso: string; dial: string; flag: string; name: string }[] = [
  { iso: 'PT', dial: '351', flag: '🇵🇹', name: 'Portugal' },
  { iso: 'ES', dial: '34', flag: '🇪🇸', name: 'España' },
  { iso: 'FR', dial: '33', flag: '🇫🇷', name: 'France' },
  { iso: 'BR', dial: '55', flag: '🇧🇷', name: 'Brasil' },
  { iso: 'BE', dial: '32', flag: '🇧🇪', name: 'Belgique' },
  { iso: 'CH', dial: '41', flag: '🇨🇭', name: 'Suisse' },
  { iso: 'GB', dial: '44', flag: '🇬🇧', name: 'United Kingdom' },
  { iso: 'DE', dial: '49', flag: '🇩🇪', name: 'Deutschland' },
  { iso: 'IT', dial: '39', flag: '🇮🇹', name: 'Italia' },
  { iso: 'NL', dial: '31', flag: '🇳🇱', name: 'Nederland' },
  { iso: 'LU', dial: '352', flag: '🇱🇺', name: 'Luxembourg' },
  { iso: 'AD', dial: '376', flag: '🇦🇩', name: 'Andorra' },
  { iso: 'AO', dial: '244', flag: '🇦🇴', name: 'Angola' },
  { iso: 'MZ', dial: '258', flag: '🇲🇿', name: 'Moçambique' },
  { iso: 'CV', dial: '238', flag: '🇨🇻', name: 'Cabo Verde' },
  { iso: 'MA', dial: '212', flag: '🇲🇦', name: 'Maroc' },
  { iso: 'US', dial: '1', flag: '🇺🇸', name: 'United States' },
  { iso: 'CA', dial: '1', flag: '🇨🇦', name: 'Canada' },
];

export function defaultCountryIso(language?: string): string {
  if (language === 'es') return 'ES';
  if (language === 'fr') return 'FR';
  if (language === 'en') return 'GB';
  return 'PT';
}

export function dialCodeForIso(iso: string): string {
  return COUNTRY_DIAL_CODES.find(c => c.iso === iso)?.dial || '351';
}

const COUNTRY_CODES_3 = [
  '998', '996', '995', '994', '993', '992', '977', '976', '975', '974', '973', '972', '971',
  '968', '967', '966', '965', '964', '963', '962', '961', '960', '886', '880', '856', '855',
  '853', '852', '423', '421', '420', '389', '387', '386', '385', '383', '382', '381', '380',
  '378', '377', '376', '375', '374', '373', '372', '371', '370', '359', '358', '357', '356',
  '355', '354', '353', '352', '351', '299', '298', '297', '258', '245', '244', '216', '213', '212',
];

const COUNTRY_CODES_2 = [
  '98', '95', '94', '93', '92', '91', '90', '86', '84', '82', '81', '66', '65', '64', '63', '62',
  '61', '60', '58', '57', '56', '55', '54', '53', '52', '51', '49', '48', '47', '46', '45', '44',
  '43', '41', '40', '39', '36', '34', '33', '32', '31', '30', '27', '20',
];

const COUNTRY_CODE_PREFIX =
  '^(351|352|353|354|355|356|357|358|359|370|371|372|373|374|375|376|377|378|380|381|382|383|385|386|387|389|420|421|423|212|213|216|244|245|258|297|298|299|852|853|855|856|880|886|960|961|962|963|964|965|966|967|968|971|972|973|974|975|976|977|992|993|994|995|996|998|20|27|30|31|32|33|34|36|39|40|41|43|44|45|46|47|48|49|51|52|53|54|55|56|57|58|60|61|62|63|64|65|66|81|82|84|86|90|91|92|93|94|95|98|1)';

function cleanInput(phone: string): string {
  return phone.trim().replace(/[\s\-\(\)\.]/g, '');
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Only infer country from bare digits when unambiguous.
 * NEVER auto-pick ES (+34) for 6/7xxxxxxxx — French mobiles look the same.
 * NEVER treat short bare numbers as international (612937777 must NOT become +61 Australia).
 */
function inferNationalFromBareDigits(digits: string): { countryCode: string; national: string } | null {
  if (/^9[1236]\d{7}$/.test(digits)) {
    return { countryCode: '351', national: digits };
  }
  // UK mobile: 07xxxxxxxxx (11) or 7xxxxxxxxx (10). Safe — FR/ES mobiles are 9 digits.
  if (/^07\d{9}$/.test(digits)) {
    return { countryCode: '44', national: digits.slice(1) };
  }
  if (/^7\d{9}$/.test(digits)) {
    return { countryCode: '44', national: digits };
  }
  if (/^0[12]\d{8,9}$/.test(digits)) {
    return { countryCode: '44', national: digits.slice(1) };
  }
  // International without + only when long enough (cc + national). 9-digit FR/ES stay bare.
  if (digits.length >= 11 && new RegExp(`${COUNTRY_CODE_PREFIX}[0-9]{6,}$`).test(digits)) {
    for (const code of COUNTRY_CODES_3) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return { countryCode: code, national: digits.slice(code.length) };
      }
    }
    for (const code of COUNTRY_CODES_2) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return { countryCode: code, national: digits.slice(code.length) };
      }
    }
    if (digits.startsWith('1') && digits.length > 1) {
      return { countryCode: '1', national: digits.slice(1) };
    }
  }
  return null;
}

function parseInternationalPhone(phone: string): { countryCode: string; national: string } {
  const cleaned = cleanInput(phone);

  if (cleaned.startsWith('+') || cleaned.startsWith('00')) {
    const raw = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned.slice(2);
    const digits = digitsOnly(raw);
    if (!digits) return { countryCode: '351', national: '' };

    for (const code of COUNTRY_CODES_3) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return { countryCode: code, national: digits.slice(code.length) };
      }
    }
    for (const code of COUNTRY_CODES_2) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return { countryCode: code, national: digits.slice(code.length) };
      }
    }
    if (digits.startsWith('1') && digits.length > 1) {
      return { countryCode: '1', national: digits.slice(1) };
    }
    return { countryCode: '351', national: digits };
  }

  const digits = digitsOnly(cleaned);
  const inferred = inferNationalFromBareDigits(digits);
  if (inferred) return inferred;

  return { countryCode: '', national: digits };
}

function nationalKeyFromE164(e164: string): string {
  const digits = e164.startsWith('+') ? e164.slice(1) : e164;

  if (/^3519\d{8}$/.test(digits)) return digits.slice(3);
  if (/^34[67]\d{8}$/.test(digits)) return digits.slice(2);
  if (/^33[67]\d{8}$/.test(digits)) return digits.slice(2);
  if (/^447\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^44[127]\d{8,9}$/.test(digits)) return `0${digits.slice(2)}`;

  if (new RegExp(`${COUNTRY_CODE_PREFIX}[0-9]{6,}$`).test(digits)) {
    for (const code of COUNTRY_CODES_3) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return digits.slice(code.length);
      }
    }
    for (const code of COUNTRY_CODES_2) {
      if (digits.startsWith(code) && digits.length > code.length) {
        return digits.slice(code.length);
      }
    }
    if (digits.startsWith('1') && digits.length > 1) {
      return digits.slice(1);
    }
  }

  return digits;
}

export function composeInternationalPhone(dialCode: string, localNumber: string): string {
  const raw = (localNumber || '').trim();
  if (!raw) return '';

  const cleaned = cleanInput(raw);
  if (cleaned.startsWith('+')) return normalizePhone(cleaned);
  if (cleaned.startsWith('00')) return normalizePhone('+' + cleaned.slice(2));

  let localDigits = digitsOnly(cleaned);
  if (!localDigits) return '';
  if (localDigits.startsWith('0')) localDigits = localDigits.slice(1);

  // Already international digits without +
  if (localDigits.startsWith('44') && localDigits.length >= 12) return normalizePhone('+' + localDigits);
  if (localDigits.startsWith('351') && localDigits.length >= 12) return normalizePhone('+' + localDigits);

  // Unambiguous national shapes override the selected dial (UK 10-digit 7…, PT 9…).
  if (/^7\d{9}$/.test(localDigits)) return normalizePhone('+44' + localDigits);
  if (/^9[1236]\d{7}$/.test(localDigits)) return normalizePhone('+351' + localDigits);

  if (localDigits.startsWith(dialCode)) return normalizePhone('+' + localDigits);
  return normalizePhone('+' + dialCode + localDigits);
}

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const { countryCode, national } = parseInternationalPhone(phone);
  if (!national || !countryCode) return '';
  return `+${countryCode}${national}`;
}

export function isValidPhone(phone: string): boolean {
  const normalizedKey = normalizePhoneKey(phone);
  return normalizedKey.length >= MIN_PHONE_DIGITS && normalizedKey.length <= MAX_PHONE_DIGITS;
}

export function normalizePhoneKey(phone: string | null | undefined): string {
  if (!phone) return '';
  const e164 = normalizePhone(phone);
  if (e164) return nationalKeyFromE164(e164);
  const digits = digitsOnly(cleanInput(phone));
  if (digits.startsWith('0') && digits.length <= 10) return digits.slice(1);
  return digits;
}

export function formatPhoneDisplay(phone: string | null | undefined): string {
  const e164 = normalizePhone(phone);
  return e164 || '';
}

export function phonesEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na && nb) return na === nb;
  const ka = normalizePhoneKey(a);
  const kb = normalizePhoneKey(b);
  return ka.length >= 8 && ka === kb;
}

export function phoneLookupCandidates(phone: string | null | undefined): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };

  const e164 = normalizePhone(phone);
  if (e164) {
    add(e164);
    add(e164.slice(1));
  }

  const key = normalizePhoneKey(phone);
  if (key.length >= 8) {
    if (/^[67]\d{8}$/.test(key)) {
      add('+33' + key);
      add('33' + key);
      add('+34' + key);
      add('34' + key);
    }
    if (/^9[1236]\d{7}$/.test(key)) {
      add('+351' + key);
      add('351' + key);
    }
    const ukKey = key.startsWith('0') ? key.slice(1) : key;
    if (/^7\d{9}$/.test(ukKey)) {
      add('+44' + ukKey);
      add('44' + ukKey);
      add('0' + ukKey);
    }
  }

  const rawDigits = digitsOnly(cleanInput(phone || ''));
  if (rawDigits) {
    add(rawDigits);
    add('+' + rawDigits);
  }

  return out;
}
