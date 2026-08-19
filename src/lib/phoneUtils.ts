/** Phone storage: international format (E.164-like), e.g. +351912345678. */

export const MIN_PHONE_DIGITS = 6;
export const MAX_PHONE_DIGITS = 15;

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

function inferNationalFromBareDigits(digits: string): { countryCode: string; national: string } | null {
  if (/^9[1236]\d{7}$/.test(digits)) {
    return { countryCode: '351', national: digits };
  }
  if (/^[67]\d{8}$/.test(digits)) {
    return { countryCode: '34', national: digits };
  }
  if (/^0[127]\d{8,9}$/.test(digits)) {
    return { countryCode: '44', national: digits.slice(1) };
  }
  if (new RegExp(`${COUNTRY_CODE_PREFIX}[0-9]{6,}$`).test(digits)) {
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

  return { countryCode: '351', national: digits };
}

function nationalKeyFromE164(e164: string): string {
  const digits = e164.startsWith('+') ? e164.slice(1) : e164;

  if (/^3519\d{8}$/.test(digits)) return digits.slice(3);
  if (/^34[67]\d{8}$/.test(digits)) return digits.slice(2);
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

/** Store with country code (+351..., +44..., +34...). */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const { countryCode, national } = parseInternationalPhone(phone);
  if (!national) return '';
  return `+${countryCode}${national}`;
}

export function isValidPhone(phone: string): boolean {
  const normalizedKey = normalizePhoneKey(phone);
  return normalizedKey.length >= MIN_PHONE_DIGITS && normalizedKey.length <= MAX_PHONE_DIGITS;
}

/** Matching key without country code (login/search). */
export function normalizePhoneKey(phone: string | null | undefined): string {
  if (!phone) return '';
  const e164 = normalizePhone(phone);
  if (!e164) return digitsOnly(cleanInput(phone));
  return nationalKeyFromE164(e164);
}
