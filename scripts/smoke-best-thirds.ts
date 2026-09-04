/**
 * Smoke: individual groups — 7 groups × top2 + 2 best 3rds = 16 QF slots
 * Run: npx tsx scripts/smoke-best-thirds.ts
 */

type P = { id: string; group: string; wins: number; gd: number; gf: number };

function selectQualified(
  byGroup: Map<string, P[]>,
  totalSlots: number,
  qualPerGroup: number
): { qualified: string[]; thirds: string[] } {
  const groups = [...byGroup.keys()].sort();
  const filtered = new Map<string, string[]>();
  groups.forEach(g => {
    const ranked = [...(byGroup.get(g) || [])].sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.gd !== b.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    filtered.set(g, ranked.slice(0, qualPerGroup).map(p => p.id));
  });

  const extraNeeded = totalSlots - qualPerGroup * groups.length;
  const thirds: string[] = [];
  if (extraNeeded > 0) {
    const candidates: P[] = [];
    groups.forEach(g => {
      const ranked = [...(byGroup.get(g) || [])].sort((a, b) => {
        if (a.wins !== b.wins) return b.wins - a.wins;
        if (a.gd !== b.gd) return b.gd - a.gd;
        return b.gf - a.gf;
      });
      if (ranked.length > qualPerGroup) candidates.push(ranked[qualPerGroup]);
    });
    candidates.sort((a, b) => {
      if (a.wins !== b.wins) return b.wins - a.wins;
      if (a.gd !== b.gd) return b.gd - a.gd;
      return b.gf - a.gf;
    });
    candidates.slice(0, extraNeeded).forEach(c => {
      filtered.get(c.group)!.push(c.id);
      thirds.push(c.id);
    });
  }

  const qualified = [...filtered.values()].flat();
  return { qualified, thirds };
}

// Simulated Bocas-like: 7 groups of 4, need 16 for QFs
const byGroup = new Map<string, P[]>();
const names = 'ABCDEFG';
for (const g of names) {
  byGroup.set(g, [
    { id: `${g}1`, group: g, wins: 3, gd: 10, gf: 16 },
    { id: `${g}2`, group: g, wins: 2, gd: 2, gf: 12 },
    { id: `${g}3`, group: g, wins: 1, gd: g === 'A' ? 5 : g === 'B' ? 4 : -1, gf: 10 },
    { id: `${g}4`, group: g, wins: 0, gd: -8, gf: 6 },
  ]);
}

const { qualified, thirds } = selectQualified(byGroup, 16, 2);

if (qualified.length !== 16) {
  console.error('FAIL expected 16 qualified, got', qualified.length, qualified);
  process.exit(1);
}
if (thirds.length !== 2) {
  console.error('FAIL expected 2 best thirds, got', thirds);
  process.exit(1);
}
if (!(thirds.includes('A3') && thirds.includes('B3'))) {
  console.error('FAIL expected A3 and B3 as best thirds (best GD), got', thirds);
  process.exit(1);
}
if (qualified.some(id => id.endsWith('4'))) {
  console.error('FAIL 4th place players should not qualify', qualified);
  process.exit(1);
}

console.log('Best thirds:', thirds.join(', '));
console.log('PASS: 7 groups × top2 + 2 best 3rds = 16');
