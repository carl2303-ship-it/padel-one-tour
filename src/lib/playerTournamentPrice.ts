/** Shared pricing helpers for tournament registration (member / non-member / staff). */

export type PriceKind = 'member' | 'non_member' | 'exempt';

export interface MemberPriceInfo {
  isMember: boolean;
  isStaff: boolean;
  planName: string | null;
  discountPercent: number;
}

export interface TournamentPriceInputs {
  registrationFee: number;
  memberPrice: number;
  nonMemberPrice: number;
  categoryRegistrationFee?: number;
  categoryMemberPrice?: number;
  categoryNonMemberPrice?: number;
}

export function normalizePhoneKey(phone: string | null | undefined): string {
  if (!phone) return '';
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, '');
  if (cleaned.startsWith('+00')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('+')) cleaned = cleaned.slice(1);
  else if (cleaned.startsWith('00')) cleaned = cleaned.slice(2);
  cleaned = cleaned.replace(/^351(?=[29]\d{8}$)/, '');
  if (cleaned.startsWith('0') && cleaned.length >= 9) cleaned = cleaned.slice(1);
  return cleaned;
}

export function normalizeNameKey(name: string | null | undefined): string {
  if (!name) return '';
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function computeTournamentPlayerPrice(
  inputs: TournamentPriceInputs,
  member: MemberPriceInfo,
): { amount: number; kind: PriceKind; label: string } {
  if (member.isStaff) {
    return { amount: 0, kind: 'exempt', label: 'Isento (staff)' };
  }

  const catReg = Number(inputs.categoryRegistrationFee) || 0;
  const catMember = Number(inputs.categoryMemberPrice) || 0;
  const catNonMember = Number(inputs.categoryNonMemberPrice) || 0;
  const tournReg = Number(inputs.registrationFee) || 0;
  const tournMember = Number(inputs.memberPrice) || 0;
  const tournNonMember = Number(inputs.nonMemberPrice) || 0;

  let base = 0;
  let kind: PriceKind = 'non_member';

  if (member.isMember) {
    kind = 'member';
    base =
      catMember > 0 ? catMember
        : tournMember > 0 ? tournMember
        : catReg > 0 ? catReg
        : tournReg;
    const usedMemberSpecific = catMember > 0 || tournMember > 0;
    if (member.discountPercent > 0 && !usedMemberSpecific) {
      base = base * (1 - member.discountPercent / 100);
    }
  } else {
    base =
      catNonMember > 0 ? catNonMember
        : tournNonMember > 0 ? tournNonMember
        : catReg > 0 ? catReg
        : tournReg;
  }

  const amount = Math.round(base * 100) / 100;
  return {
    amount,
    kind,
    label: kind === 'member' ? 'Membro' : 'Não membro',
  };
}
