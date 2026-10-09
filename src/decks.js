// Offline fallback card data (name|cost|type|p/t|colors) and the four sample decks.
// Scryfall data replaces these entries as soon as it loads.

const DB_TEXT = `Krenko, Mob Boss|{2}{R}{R}|Legendary Creature — Goblin Warrior|3/3|R
Krenko, Tin Street Kingpin|{2}{R}|Legendary Creature — Goblin|1/2|R
Goblin Chieftain|{1}{R}{R}|Creature — Goblin|2/2|R
Goblin Warchief|{1}{R}{R}|Creature — Goblin Warrior|2/2|R
Skirk Prospector|{R}|Creature — Goblin|1/1|R
Goblin Matron|{2}{R}|Creature — Goblin|1/1|R
Goblin Rabblemaster|{2}{R}|Creature — Goblin Warrior|2/2|R
Legion Loyalist|{R}|Creature — Goblin Soldier|1/1|R
Beetleback Chief|{2}{R}{R}|Creature — Goblin Warrior|2/2|R
Siege-Gang Commander|{3}{R}{R}|Creature — Goblin|2/2|R
Purphoros, God of the Forge|{3}{R}|Legendary Enchantment Creature — God|6/5|R
Impact Tremors|{1}{R}|Enchantment||R
Goblin Bombardment|{1}{R}|Enchantment||R
Lightning Bolt|{R}|Instant||R
Chaos Warp|{2}{R}|Instant||R
Vandalblast|{R}|Sorcery||R
Blasphemous Act|{8}{R}|Sorcery||R
Hordeling Outburst|{1}{R}{R}|Sorcery||R
Talrand, Sky Summoner|{2}{U}{U}|Legendary Creature — Merfolk Wizard|2/2|U
Archmage Emeritus|{2}{U}{U}|Creature — Human Wizard|2/2|U
Ponder|{U}|Sorcery||U
Preordain|{U}|Sorcery||U
Brainstorm|{U}|Instant||U
Opt|{U}|Instant||U
Counterspell|{U}{U}|Instant||U
Mana Drain|{U}{U}|Instant||U
Arcane Denial|{1}{U}|Instant||U
Swan Song|{U}|Instant||U
Cyclonic Rift|{1}{U}|Instant||U
Frantic Search|{2}{U}|Instant||U
High Tide|{U}|Instant||U
Pongify|{U}|Instant||U
Rapid Hybridization|{U}|Instant||U
Reality Shift|{1}{U}|Instant||U
Rhystic Study|{2}{U}|Enchantment||U
Mystic Remora|{U}|Enchantment||U
Metallurgic Summonings|{3}{U}{U}|Enchantment||U
Meren of Clan Nel Toth|{2}{B}{G}|Legendary Creature — Human Shaman|3/4|BG
Sakura-Tribe Elder|{1}{G}|Creature — Snake Shaman|1/1|G
Eternal Witness|{1}{G}{G}|Creature — Human Shaman|2/1|G
Llanowar Elves|{G}|Creature — Elf Druid|1/1|G
Spore Frog|{G}|Creature — Frog|1/1|G
Viscera Seer|{B}|Creature — Vampire Wizard|1/1|B
Plaguecrafter|{2}{B}|Creature — Human Shaman|3/2|B
Ravenous Chupacabra|{2}{B}{B}|Creature — Horror|2/2|B
Grave Pact|{1}{B}{B}{B}|Enchantment||B
Living Death|{3}{B}{B}|Sorcery||B
Demonic Tutor|{1}{B}|Sorcery||B
Beast Within|{2}{G}|Instant||G
Assassin's Trophy|{B}{G}|Instant||BG
Skullclamp|{1}|Artifact — Equipment||
Golgari Signet|{2}|Artifact||
Woodland Cemetery||Land||
Overgrown Tomb||Land — Swamp Forest||
Sythis, Harvest's Hand|{G}{W}|Legendary Enchantment Creature — Nymph|1/2|GW
Argothian Enchantress|{1}{G}|Creature — Human Druid|0/1|G
Enchantress's Presence|{2}{G}|Enchantment||G
Sterling Grove|{G}{W}|Enchantment||GW
Utopia Sprawl|{G}|Enchantment — Aura||G
Wild Growth|{G}|Enchantment — Aura||G
Sanctum Weaver|{1}{G}|Enchantment Creature — Dryad|0/2|G
Destiny Spinner|{1}{G}|Enchantment Creature — Human|2/3|G
Setessan Champion|{2}{G}|Enchantment Creature — Human Druid|1/3|G
Eidolon of Blossoms|{2}{G}{G}|Enchantment Creature — Spirit|2/2|G
Sigil of the Empty Throne|{3}{W}{W}|Enchantment||W
Starfield of Nyx|{4}{W}|Enchantment||W
Path to Exile|{W}|Instant||W
Wrath of God|{2}{W}{W}|Sorcery||W
Selesnya Signet|{2}|Artifact||
Temple Garden||Land — Forest Plains||
Sol Ring|{1}|Artifact||
Arcane Signet|{2}|Artifact||
Mind Stone|{2}|Artifact||
Fellwar Stone|{2}|Artifact||
Thought Vessel|{2}|Artifact||
Lightning Greaves|{2}|Artifact — Equipment||
Swiftfoot Boots|{2}|Artifact — Equipment||
Swords to Plowshares|{W}|Instant||W
Cultivate|{2}{G}|Sorcery||G
Kodama's Reach|{2}{G}|Sorcery||G
Command Tower||Land||
Evolving Wilds||Land||
Reliquary Tower||Land||
Plains||Basic Land — Plains||
Island||Basic Land — Island||
Swamp||Basic Land — Swamp||
Mountain||Basic Land — Mountain||
Forest||Basic Land — Forest||
Wastes||Basic Land||`;

export const DB = {};
DB_TEXT.split('\n').forEach((l) => {
  const [name, cost, type, pt, colors] = l.split('|');
  DB[name.toLowerCase()] = { name, cost, type, pt, colors };
});

const SAMPLES = [
  { cmd: 'Krenko, Mob Boss', basics: ['Mountain'], cards: ['Krenko, Tin Street Kingpin', 'Goblin Chieftain', 'Goblin Warchief', 'Skirk Prospector', 'Goblin Matron', 'Goblin Rabblemaster', 'Legion Loyalist', 'Beetleback Chief', 'Siege-Gang Commander', 'Purphoros, God of the Forge', 'Impact Tremors', 'Goblin Bombardment', 'Lightning Bolt', 'Chaos Warp', 'Vandalblast', 'Blasphemous Act', 'Hordeling Outburst', 'Sol Ring', 'Arcane Signet', 'Mind Stone', 'Fellwar Stone', 'Lightning Greaves', 'Swiftfoot Boots', 'Command Tower', 'Reliquary Tower'] },
  { cmd: 'Talrand, Sky Summoner', basics: ['Island'], cards: ['Archmage Emeritus', 'Ponder', 'Preordain', 'Brainstorm', 'Opt', 'Counterspell', 'Mana Drain', 'Arcane Denial', 'Swan Song', 'Cyclonic Rift', 'Frantic Search', 'High Tide', 'Pongify', 'Rapid Hybridization', 'Reality Shift', 'Rhystic Study', 'Mystic Remora', 'Metallurgic Summonings', 'Sol Ring', 'Arcane Signet', 'Mind Stone', 'Thought Vessel', 'Command Tower', 'Reliquary Tower'] },
  { cmd: 'Meren of Clan Nel Toth', basics: ['Swamp', 'Forest'], cards: ['Sakura-Tribe Elder', 'Eternal Witness', 'Llanowar Elves', 'Spore Frog', 'Viscera Seer', 'Plaguecrafter', 'Ravenous Chupacabra', 'Grave Pact', 'Living Death', 'Demonic Tutor', 'Beast Within', "Assassin's Trophy", 'Skullclamp', 'Golgari Signet', 'Cultivate', "Kodama's Reach", 'Sol Ring', 'Arcane Signet', 'Command Tower', 'Woodland Cemetery', 'Overgrown Tomb', 'Evolving Wilds'] },
  { cmd: "Sythis, Harvest's Hand", basics: ['Forest', 'Plains'], cards: ['Argothian Enchantress', "Enchantress's Presence", 'Sterling Grove', 'Utopia Sprawl', 'Wild Growth', 'Sanctum Weaver', 'Destiny Spinner', 'Setessan Champion', 'Eidolon of Blossoms', 'Sigil of the Empty Throne', 'Starfield of Nyx', 'Swords to Plowshares', 'Path to Exile', 'Wrath of God', 'Selesnya Signet', 'Cultivate', "Kodama's Reach", 'Sol Ring', 'Arcane Signet', 'Command Tower', 'Temple Garden', 'Evolving Wilds'] },
];

/** Sample decklist text for seat i: a legal 100-card Commander list (commander + 99), padded with basics. */
export function buildSample(i) {
  const s = SAMPLES[i % SAMPLES.length];
  const need = Math.max(0, 99 - s.cards.length);
  const per = s.basics.map((b, k) => Math.floor(need / s.basics.length) + (k < need % s.basics.length ? 1 : 0));
  return `Commander\n1 ${s.cmd}\n\nDeck\n${s.cards.map((n) => '1 ' + n).join('\n')}\n${s.basics.map((b, k) => per[k] + ' ' + b).join('\n')}`;
}
