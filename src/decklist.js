// Decklist text: parsing (Moxfield / Archidekt / plain), validation and export. Shared by the table and the deck manager.
export function parseList(text, cmdOverride, typeOf = () => '') {
  let section = 'deck'; let cmd = []; const main = []; const cmdPrints = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const l = raw.trim(); if (!l || l.startsWith('//') || l.startsWith('#')) continue;
    const head = l.replace(/:$/, '').replace(/\s*\(\d+\)$/, '').toLowerCase();
    if (/^(commanders?|deck|main ?deck|mainboard|sideboard|maybeboard|considering|companion|tokens?)$/.test(head)) {
      section = head.startsWith('commander') ? 'cmd' : /^(side|maybe|consid|token|companion)/.test(head) ? 'skip' : 'deck'; continue;
    }
    const m = l.match(/^(\d+)\s*x?\s+(.+)$/i); let n = 1, name = l; if (m) { n = +m[1]; name = m[2]; }
    const isC = /\*cmdr\*|\[[^\]]*commander[^\]]*\]|\^commander/i.test(name);
    const foil = /\*F\*|\*E\*|\(foil\)|\bfoil\b/i.test(name);
    const sm = name.match(/\[sf=([0-9a-f-]{36})\]/i); const sfid = sm ? sm[1].toLowerCase() : '';
    const pm = name.replace(/\s*\[[^\]]*\]\s*/g, ' ').match(/\(([A-Za-z0-9]{2,6})\)\s+([\w★†Φ-]+)/); const set = pm ? pm[1].toLowerCase() : ''; const num = pm ? pm[2] : '';
    name = name.replace(/\s*\*[A-Za-z]+\*\s*/g, ' ').replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s*\^[^^]*\^\s*/g, ' ').replace(/\s+\([A-Za-z0-9]{2,6}\)(\s+[\w★-]+)?\s*$/, '').replace(/\s+/g, ' ').trim();
    if (!name || section === 'skip') continue;
    if (section === 'cmd' || isC) { cmd.push(name); if (set) cmdPrints[name] = { set, num, foil, sfid }; } else main.push({ n, name, set, num, foil, sfid });
  }
  if (cmdOverride && cmdOverride.trim()) {
    const nm = cmdOverride.trim(); const hit = main.find((e) => e.name.toLowerCase() === nm.toLowerCase()); if (hit) hit.n--; cmd = [hit ? hit.name : nm];
  }
  if (!cmd.length && main.length) {
    const leg = main.find((e) => /Legendary/.test(typeOf(e.name)) && /(Creature|can be your commander)/.test(typeOf(e.name)));
    if (leg) { cmd.push(leg.name); leg.n--; }
  }
  const list = main.filter((e) => e.n > 0);
  const count = list.reduce((a, e) => a + e.n, 0);
  return { cmd, main: list, count, cmdPrints };
}

/** Commander-legality checks a deck manager cares about. `typeOf` resolves a card name to its type line when known. */
export function deckStats(d, typeOf = () => '') {
  const total = d.count + d.cmd.length; const issues = [];
  const seen = new Map(); d.main.forEach((e) => seen.set(e.name.toLowerCase(), (seen.get(e.name.toLowerCase()) || 0) + e.n));
  const dupes = [...seen.entries()].filter(([n, k]) => k > 1 && !/^(plains|island|swamp|mountain|forest|wastes|snow-covered )/.test(n) && !/Basic/.test(typeOf(n))).map(([n]) => n);
  if (!d.cmd.length) issues.push('No commander marked');
  if (d.cmd.length > 2) issues.push('More than two commanders');
  if (total !== 100) issues.push(`${total} cards (Commander decks are exactly 100)`);
  if (dupes.length) issues.push(`Duplicates: ${dupes.slice(0, 3).join(', ')}${dupes.length > 3 ? '…' : ''}`);
  const lands = d.main.filter((e) => /Land/.test(typeOf(e.name)) || /^(plains|island|swamp|mountain|forest|wastes)$/i.test(e.name)).reduce((a, e) => a + e.n, 0);
  return { total, lands, issues, ok: issues.length === 0 };
}
const tag = (e) => (e.set && e.num ? ` (${e.set}) ${e.num}` : '') + (e.foil ? ' *F*' : '') + (e.sfid ? ` [sf=${e.sfid}]` : '');
export function deckText(d) { return `Commander\n${d.cmd.map((n) => '1 ' + n + tag(d.cmdPrints?.[n] || {})).join('\n')}\n\nDeck\n${d.main.map((e) => e.n + ' ' + e.name + tag(e)).join('\n')}`; }
