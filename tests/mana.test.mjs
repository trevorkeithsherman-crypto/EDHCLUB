// Mana rules: costs, sources and the payment solver (CR 106/107/202 behaviour the bots rely on).
import { parseCost, unitsOf, solve } from '../src/mana.js';
let fails = 0; const check = (n, ok, note = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n, ok ? '' : note); if (!ok) fails++; };
const land = (name, type, oracle = '') => ({ id: name, name, type, oracle, zone: 'battlefield', tapped: false });
const perm = (name, type, oracle, extra = {}) => ({ id: name, name, type, oracle, zone: 'battlefield', tapped: false, ...extra });
const U = (cards, ctx) => cards.flatMap((c) => unitsOf(c, ctx));
const pays = (cost, cards, opts) => !!solve(parseCost(cost), U(cards, opts && opts.ctx), opts);
// costs
let c = parseCost('{2}{G}{G/U}{W/P}{C}{X}');
check('parseCost reads generic, colored, hybrid, Phyrexian, colorless and X', c.generic === 2 && c.pips.length === 4 && c.pips[1].opts.join('') === 'GU' && c.pips[2].phy && c.pips[3].opts[0] === 'C' && c.x);
// sources
check('Forest makes G', U([land('Forest', 'Basic Land — Forest')]).map((u) => u.colors.join('')).join() === 'G');
check('Reliquary Tower ({T}: Add {C}) makes only colorless', U([land('Reliquary Tower', 'Land', 'You have no maximum hand size.\n{T}: Add {C}.')]).map((u) => u.colors.join('')).join() === 'C');
check('Breeding Pool (Forest Island type line) makes G or U', U([land('Breeding Pool', 'Land — Forest Island', 'As Breeding Pool enters, you may pay 2 life...')]).map((u) => u.colors.slice().sort().join('')).join() === 'GU');
check('Sol Ring makes two colorless', U([perm('Sol Ring', 'Artifact', '{T}: Add {C}{C}.')]).map((u) => u.colors.join('')).join() === 'C,C');
check('Command Tower makes the commander\'s colors', U([land('Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity.")], { identity: ['R', 'G'] }).map((u) => u.colors.join('')).join() === 'RG');
check('Arcane Signet too', U([perm('Arcane Signet', 'Artifact', "{T}: Add one mana of any color in your commander's color identity.")], { identity: ['U'] }).map((u) => u.colors.join('')).join() === 'U');
check('Golgari Signet ({1},{T}: Add {B}{G}) nets one mana of either color', U([perm('Golgari Signet', 'Artifact', '{1}, {T}: Add {B}{G}.')]).map((u) => u.colors.join('')).join() === 'BG');
check('Treasure makes any color and is marked for sacrifice', (() => { const u = U([perm('Treasure', 'Token Artifact — Treasure', '{T}, Sacrifice this artifact: Add one mana of any color.')]); return u.length === 1 && u[0].colors.length === 5; })());
check('Llanowar Elves taps for G only when not summoning sick', U([perm('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.', { sick: true })]).length === 0 && U([perm('Llanowar Elves', 'Creature — Elf Druid', '{T}: Add {G}.', { sick: false })]).map((u) => u.colors.join('')).join() === 'G');
check('Karplusan Forest ({T}: Add {R} or {G}) is one unit of either', U([land('Karplusan Forest', 'Land', '{T}: Add {C}.\n{T}: Add {R} or {G}. Karplusan Forest deals 1 damage to you.')]).map((u) => u.colors.join('')).sort().join() === 'C,RG');
check('a tapped land makes nothing', U([{ ...land('Forest', 'Basic Land — Forest'), tapped: true }]).length === 0);
check('Maze of Ith makes no mana', U([land('Maze of Ith', 'Land', '{T}: Untap target attacking creature. Prevent all combat damage...')]).length === 0);
// payment
const F = land('Forest', 'Basic Land — Forest'), F2 = { ...F, id: 'F2' }, I = land('Island', 'Basic Land — Island'), M = land('Mountain', 'Basic Land — Mountain'), RT = land('Reliquary Tower', 'Land', '{T}: Add {C}.'), SR = perm('Sol Ring', 'Artifact', '{T}: Add {C}{C}.');
check('{G} cannot be paid by a colorless land (the bug)', !pays('{G}', [RT]));
check('{G} is paid by a Forest', pays('{G}', [F]));
check('{1}{G} with Forest + Reliquary Tower: Tower pays the generic', (() => { const r = solve(parseCost('{1}{G}'), U([F, RT])); return r && r.used.map((u) => u.src.name).sort().join() === 'Forest,Reliquary Tower'; })());
check('{G}{G} with Forest + Sol Ring is NOT payable', !pays('{G}{G}', [F, SR]));
check('{3}{G} with Forest + Sol Ring + Island: Sol Ring and Island pay generic', (() => { const r = solve(parseCost('{3}{G}'), U([F, SR, I])); return r && r.used.length === 4 && r.used.filter((u) => u.src.name === 'Forest').length === 1; })());
check('{G/U} hybrid is paid by an Island', pays('{G/U}', [I]));
check('{R}{G} with Karplusan Forest + Mountain uses the dual for G', (() => { const r = solve(parseCost('{R}{G}'), U([land('Karplusan Forest', 'Land', '{T}: Add {R} or {G}.'), M])); return !!r; })());
check('{R}{G} with Karplusan Forest alone fails (one unit, two pips)', !pays('{R}{G}', [land('Karplusan Forest', 'Land', '{T}: Add {R} or {G}.')]));
check('{C} (Kozilek-style) needs colorless mana: a Forest cannot pay it', !pays('{C}', [F]) && pays('{C}', [RT]));
check('{1}{B/P} with two Mountains: generic from one, 2 life for the Phyrexian pip', (() => { const r = solve(parseCost('{1}{B/P}'), U([M, { ...M, id: 'M2' }]), { life: 30 }); return r && r.life === 2 && r.used.length === 1; })());
check('…but not at 10 life or less', !solve(parseCost('{1}{B/P}'), U([M, { ...M, id: 'M2' }]), { life: 9 }));
check('generic prefers colorless/utility sources and keeps colored ones open', (() => { const r = solve(parseCost('{2}'), U([F, I, RT, SR])); return r && !r.used.some((u) => u.src.name === 'Forest' || u.src.name === 'Island'); })());
check('commander tax adds generic', !pays('{2}{R}{R}', [M, { ...M, id: 'M2' }, F, F2], { extraGeneric: 2 }) && pays('{2}{R}{R}', [M, { ...M, id: 'M2' }, F, F2, I], { extraGeneric: 1 }));
check('floating mana pays generic first', (() => { const r = solve(parseCost('{2}{G}'), U([F]), { floating: 2 }); return r && r.floatingUsed === 2 && r.used.length === 1; })());
check('Command Tower pays a commander color', pays('{U}', [land('Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity.")], { ctx: { identity: ['U', 'W'] } }));
check('…and not a color outside the identity', !pays('{B}', [land('Command Tower', 'Land', "{T}: Add one mana of any color in your commander's color identity.")], { ctx: { identity: ['U', 'W'] } }));
console.log(fails ? `\n${fails} failed` : '\nall mana checks passed'); process.exit(fails ? 1 : 0);
