/** Phone storage: national digits only (no +, no country code). */

export const MIN_PHONE_DIGITS = 6;
export const MAX_PHONE_DIGITS = 15;

/** 3-digit then 2-digit country codes (longest-match). Never applied to bare PT/ES 9-digit mobiles. */
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

function isPtMobile(digits: string): boolean {
  return /^9[1236]\d{7}$/.test(digits);
}

function isEsMobile(digits: string): boolean {
  return /^[67]\d{8}$/.test(digits);
}

/**
 * Normaliza para dígitos nacionais (sem indicativo).
 * PT: 925358087 — nunca corta 91/92 de um móvel PT de 9 dígitos.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';

  let cleaned = phone.trim().replace(/[\s\-\(\)\.]/g, '');

  if (cleaned.startsWith('+00')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  else if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);

  let digits = cleaned.replace(/\D/g, '');

  // Bare PT / ES national mobiles — keep as-is (fixes "+925358087" after removing +)
  if (isPtMobile(digits) || isEsMobile(digits)) return digits;

  if (/^3519\d{8}$/.test(digits)) return digits.slice(3);
  if (/^34[67]\d{8}$/.test(digits)) return digits.slice(2);

  // Only strip country codes on longer international numbers
  if (digits.length >= 11) {
    for (const code of COUNTRY_CODES_3) {
      if (digits.startsWith(code) && digits.length > code.length + MIN_PHONE_DIGITS - 1) {
        digits = digits.slice(code.length);
        break;
      }
    }
    if (digits.length >= 11) {
      for (const code of COUNTRY_CODES_2) {
        if (digits.startsWith(code) && digits.length > code.length + MIN_PHONE_DIGITS - 1) {
          digits = digits.slice(code.length);
          break;
        }
      }
    }
    if (digits.length >= 11 && /^[17]\d{9,}$/.test(digits)) {
      digits = digits.slice(1);
    }
  } else if (/^351[29]\d{8}$/.test(digits)) {
    digits = digits.slice(3);
  }

  if (digits.startsWith('0') && digits.length > MIN_PHONE_DIGITS) {
    digits = digits.slice(1);
  }

  return digits;
}

export function isValidPhone(phone: string): boolean {
  const normalized = normalizePhone(phone);
  return normalized.length >= MIN_PHONE_DIGITS && normalized.length <= MAX_PHONE_DIGITS;
}

/** Alias used across Tour for membership/payment matching */
export function normalizePhoneKey(phone: string | null | undefined): string {
  return normalizePhone(phone);
}
