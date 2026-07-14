/** Comprimento mínimo/máximo do número nacional após normalização (E.164). */
export const MIN_PHONE_DIGITS = 6;
export const MAX_PHONE_DIGITS = 15;

const COUNTRY_CODES = [
  '998', '996', '995', '994', '993', '992', '977', '976', '975', '974', '973', '972', '971',
  '968', '967', '966', '965', '964', '963', '962', '961', '960', '886', '880', '856', '855',
  '853', '852', '423', '421', '420', '389', '387', '386', '385', '383', '382', '381', '380',
  '378', '377', '376', '375', '374', '373', '372', '371', '370', '359', '358', '357', '356',
  '355', '354', '353', '352', '351', '299', '298', '297', '258', '245', '244', '216', '213', '212',
  '98', '95', '94', '93', '92', '91', '90', '86', '84', '82', '81', '66', '65', '64', '63', '62',
  '61', '60', '58', '57', '56', '55', '54', '53', '52', '51', '49', '48', '47', '46', '45', '44',
  '43', '41', '40', '39', '36', '34', '33', '32', '31', '30', '27', '20',
];

function stripOneCountryCode(digits: string): string {
  for (const code of COUNTRY_CODES) {
    if (digits.startsWith(code) && digits.length > code.length + MIN_PHONE_DIGITS - 1) {
      return digits.slice(code.length);
    }
  }
  if (digits.startsWith('1') && digits.length >= 11) {
    return digits.slice(1);
  }
  return digits;
}

export function normalizePhone(phone: string): string {
  if (!phone) return '';

  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');
  let hadIntlPrefix = false;

  if (cleaned.startsWith('+00')) {
    cleaned = cleaned.slice(3);
    hadIntlPrefix = true;
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
    hadIntlPrefix = true;
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.slice(2);
    hadIntlPrefix = true;
  }

  cleaned = cleaned.replace(/\D/g, '');

  if (hadIntlPrefix) {
    cleaned = stripOneCountryCode(cleaned);
  } else {
    if (/^351[29]\d{8}$/.test(cleaned)) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.startsWith('0') && cleaned.length > MIN_PHONE_DIGITS) {
      cleaned = cleaned.slice(1);
    }
    if (cleaned.length > 10) {
      const stripped = stripOneCountryCode(cleaned);
      if (stripped.length >= MIN_PHONE_DIGITS && stripped.length < cleaned.length) {
        cleaned = stripped;
      }
    }
  }

  return cleaned;
}

export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return normalized.length >= MIN_PHONE_DIGITS && normalized.length <= MAX_PHONE_DIGITS;
}
