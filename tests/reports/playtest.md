# Bot playtest report — 10 four-bot games

Decks: generated 100-card Commander decks (commander + 63 nonland + lands) drawn from cards printed in Commander products, real oracle text. Bots at "instant" pace; every turn the harness checks zone bookkeeping (every card in exactly one zone, 100 cards per player, no counters/damage off the battlefield, lethal damage dies), life totals and JS errors.

| game | commanders (seat 1-4) | turns | winner | casts | attacks | state problems | JS errors |
|---|---|---|---|---|---|---|---|
| 1 | Old Stickfingers, Baldin, Century Herdmaster, Shao Jun, Sakashima of a Thousand Faces | 13 | Old Stickfingers | 31 | 53 | 0 | 0 |
| 2 | Nymris, Oona's Trickster, Skithiryx, the Blight Dragon, Long Feng, Grand Secretariat, Thassa, God of the Sea | 13 | Skithiryx, the Blight Dragon | 47 | 43 | 0 | 0 |
| 3 | Shalai, Voice of Plenty, Fortune, Loyal Steed, Wernog, Rider's Chaplain, Inquisitor Eisenhorn | 15 | Fortune, Loyal Steed (last at 38; one other at 16 when the turn cap hit) | 32 | 49 | 0 | 0 |
| 4 | Erinis, Gloom Stalker, Rosnakht, Heir of Rohgahh, Seshiro the Anointed, Kellogg, Dangerous Mind | 15 | Kellogg, Dangerous Mind | 28 | 35 | 0 | 0 |
| 5 | Momo, Friendly Flier, Rhonas the Indomitable, Mowu, Loyal Companion, Araña, Heart of the Spider | 15 | Momo, Friendly Flier | 13 | 69 | 0 | 0 |
| 6 | Raff Capashen, Ship's Mage, Sigarda, Heron's Grace, Dragonlord Silumgar, Rograkh, Son of Rohgahh | 14 | Raff Capashen, Ship's Mage | 35 | 55 | 0 | 0 |
| 7 | Alphinaud Leveilleur, Gor Muldrak, Amphinologist, Razaketh, the Foulblooded, Amarant Coral | 18 | Alphinaud Leveilleur | 39 | 41 | 0 | 0 |
| 8 | The Boulder, Ready to Rumble, The Howling Abomination, Azula, Cunning Usurper, Zimone, Mystery Unraveler | 8 | Azula, Cunning Usurper | 21 | 28 | 0 | 0 |
| 9 | Mog, Moogle Warrior, Urabrask, Heretic Praetor, Ardenn, Intrepid Archaeologist, Uyo, Silent Prophet | 17 | Ardenn, Intrepid Archaeologist | 27 | 43 | 0 | 0 |
| 10 | Nissa, Resurgent Animist, Brothers Yamazaki, Curie, Emergent Intelligence, Wort, Boggart Auntie | 15 | Brothers Yamazaki | 59 | 34 | 0 | 0 |

All 10 games ended with a single survivor; none stalled.

## Triggers resolved by the table vs left to the pod (log counts across games)

- manual: Crescendo of War: 17
- auto: Urabrask, Heretic Praetor: 17
- manual: Ring of Valkas: 13
- manual: Firebender Ascension: 13
- auto: Rosnakht, Heir of Rohgahh: 13
- manual: Araña, Heart of the Spider: 11
- auto: Revenge of Ravens: 11
- auto: Paradise Plume: 10
- manual: Within Range: 9
- auto: Thassa, God of the Sea: 8
- auto: Kellogg, Dangerous Mind: 8
- manual: Beckoning Will-o'-Wisp: 7
- auto: Helm of the Host: 7
- auto: Syr Konrad, the Grim: 7
- manual: Ardenn, Intrepid Archaeologist: 7
- auto: Overseer of Vault 76: 7
- auto: Bloodgift Demon: 7
- auto: Swarm of Bloodflies: 6
- auto: Asylum Visitor: 6
- auto: Tireless Provisioner: 5
- auto: Ezuri, Claw of Progress: 5
- manual: Replicating Ring: 5
- auto: Mana-Charged Dragon: 5
- manual: Chalice of the Void: 5
- auto: Curie, Emergent Intelligence: 5
- auto: Serene Sleuth: 5
- manual: Fortune, Loyal Steed: 5
- auto: Monument: 4
- auto: Squad Commander: 4
- manual: Inversion Behemoth: 4
- manual: Wort, Boggart Auntie: 4
- manual: Crystalline Giant: 4
- auto: Iguana Parrot: 4
- manual: Skyclave Shade: 4
- manual: Varchild, Betrayer of Kjeldor: 3
- auto: Galepowder Mage: 3
- manual: Lux Artillery: 3
- auto: Phyrexian Arena: 3
- auto: Reaver: 3
- auto: Trickster: 3

## Trigger text the interpreter still leaves to the table

- Relic Axe: When this Equipment enters, attach it to target creature you control.
- Nalfeshnee: Whenever you cast a spell from exile, copy it. You may choose new targets for the copy. If
- Geometric Nexus: Whenever a player casts an instant or sorcery spell, put a number of charge counters on th
- Hostility: When ~ is put into a graveyard from anywhere, shuffle it into its owner's library.
- Eldritch Immunity (spell): no effect understood
- Ascend from Avernus (spell): no effect understood
- Bane of Bala Ged: Whenever this creature attacks, defending player exiles two permanents they control.
- Dawnglade Regent: When this creature enters, you become the monarch.
- Emeria Shepherd: Whenever a land you control enters, you may return target nonland permanent card from your
- Fey Steed: Whenever this creature attacks, another target attacking creature you control gains indest
- Fortune, Loyal Steed: Whenever ~ attacks while saddled, at end of combat, exile it and up to one creature that s
- From the Rubble: At the beginning of your end step, return target creature card of the chosen type from you
- Ironwill Forger: At the beginning of combat on your turn, if you control your commander, target nonlegendar
- Junk Diver: When this creature dies, return another target artifact card from your graveyard to your h
- Meltstrider's Gear: When this Equipment enters, attach it to target creature you control.
- Past in Flames (spell): no effect understood
- Staunch Throneguard: When this creature enters, you become the monarch.
- Pinnacle Kill-Ship: When this Spacecraft enters, it deals 10 damage to up to one target creature.
- Skyclave Relic: When this artifact enters, if it was kicked, create two tapped tokens that are copies of t
- Trailblazer's Torch: When this Equipment enters, you take the initiative.
- Sudden Substitution (spell): no effect understood
- Getaway Car: Whenever this Vehicle attacks or blocks, return up to one target creature that crewed it t
- Spider-Bot: When this creature enters, you may search your library for a basic land card, reveal it, t
- Angel of Salvation: When this creature enters, prevent the next 5 damage that would be dealt this turn to any 
- Appa, Steadfast Guardian: When ~ enters, airbend any number of other target nonland permanents you control.
- Araña, Heart of the Spider: Whenever you attack, put a +1/+1 counter on target attacking creature.
- Backdraft Hellkite: Whenever this creature attacks, each instant and sorcery card in your graveyard gains flas
- Balance (spell): no effect understood
- Beckoning Will-o'-Wisp: At the beginning of combat on your turn, choose an opponent.
- Campsite Cuisine: Whenever you attack, you may sacrifice X Foods. When you do, up to X target attacking crea
- Cavalry Pegasus: Whenever this creature attacks, each attacking Human gains flying until end of turn.
- Collective Voyage (spell): no effect understood
- Geode Golem: Whenever this creature deals combat damage to a player, you may cast your commander from t
- Guildless Commons: When this land enters, return a land you control to its owner's hand.
- Killer Service: When this enchantment enters, create a number of Food tokens equal to the number of oppone
- Maester Seymour: At the beginning of combat on your turn, put a number of +1/+1 counters equal to ~'s power
- Morningtide's Light (spell): no effect understood
- Quick-Draw Dagger: When this Equipment enters, attach it to target creature you control. That creature gains 
- Roving Actuator: When this creature enters, if a nonland permanent left the battlefield this turn or a spel
- Rug of Smothering: Whenever a player casts a spell, they lose 1 life for each spell they've cast this turn.
- Ruxa, Patient Professor: Whenever ~ enters or attacks, return target creature card with no abilities from your grav
- Satyr Wayfinder: When this creature enters, reveal the top four cards of your library. You may put a land c
- Seeds of Renewal (spell): no effect understood
- Selfless Police Captain: When this creature leaves the battlefield, put its +1/+1 counters on target creature you c
- Skyfire Phoenix: When you cast your commander, return this card from your graveyard to the battlefield.
- Spatial Contortion (spell): no effect understood
- Starling, Aerial Ally: When ~ enters, another target creature you control gains flying until end of turn.
- Séance Board: At the beginning of each end step, if a creature died this turn, put a soul counter on thi
- Tail Swipe (spell): no effect understood
- The Endstone: At the beginning of your end step, your life total becomes half your starting life total, 
- The Mana Rig: Whenever you cast a multicolored spell, create a tapped Powerstone token.
- Thurid, Mare of Destiny: Whenever you cast a Pegasus, Unicorn, or Horse creature spell, copy it.
- Titan of Industry: When this creature enters, choose two —
- Undercellar Sweep: When this enchantment enters, you take the initiative.
- Wake the Past (spell): no effect understood
- Wall of Reverence: At the beginning of your end step, you may gain life equal to the power of target creature
- Wedding Ring: When this artifact enters, if it was cast, target opponent creates a token that's a copy o
- White Plume Adventurer: When this creature enters, you take the initiative.
- Wild Beastmaster: Whenever this creature attacks, each other creature you control gets +X/+X until end of tu
- Worldspine Wurm: When ~ is put into a graveyard from anywhere, shuffle it into its owner's library.
- Badgermole: When this creature enters, earthbend 2.
- Crippling Fear (spell): no effect understood
- Duskmantle Seer: At the beginning of your upkeep, each player reveals the top card of their library, loses 
- Filigree Vector: When this creature enters, put a +1/+1 counter on each of any number of target creatures a
- Gonti, Lord of Luxury: When ~ enters, look at the top four cards of target opponent's library, exile one of them 
- Shard of the Nightbringer: When this creature enters, if you cast it, target opponent loses half their life, rounded 
- Ainok Guide: When this creature enters, choose one —
- Close Encounter (spell): no effect understood
- Omarthis, Ghostfire Initiate: When ~ dies, manifest a number of cards from the top of your library equal to the number o
- Ring of Valkas: At the beginning of your upkeep, put a +1/+1 counter on equipped creature if it's red.
- Thought-Knot Seer: When this creature enters, target opponent reveals their hand. You choose a nonland card f
- Vessel of Endless Rest: When this artifact enters, put target card from a graveyard on the bottom of its owner's l
- Voracious Greatshark: When this creature enters, counter target artifact or creature spell.
- Aarakocra Sneak: When this creature enters, you take the initiative.
- Lux Artillery: Whenever you cast an artifact creature spell, it gains sunburst.
- Rocket-Powered Goblin Glider: When this Equipment enters, if it was cast from your graveyard, attach it to target creatu
- Scrounging Bandar: At the beginning of your upkeep, you may move any number of +1/+1 counters from this creat
- World Shaper: When this creature dies, return all land cards from your graveyard to the battlefield tapp
- Mob Rule (spell): no effect understood
- Twins of Discord: Whenever you attack, choose odd or even. Creatures with mana value of that quality can't b

## Activated abilities not understood

- Spectral Searchlight: {T}: Choose a player. That player adds one mana of any color they choose.
- Hostile Desert: {2}, Exile a land card from your graveyard: This land becomes a 3/4 Elemental creature unt
- Sword of the Paruns: {3}: You may tap or untap equipped creature.
- Perpetual Timepiece: {2}, Exile this artifact: Shuffle any number of target cards from your graveyard into your
- The Warring Triad: {T}, Mill a card: Target player adds one mana of any color.
- Peter Parker's Camera: {2}, {T}, Remove a film counter from this artifact: Copy target activated or triggered abi
- Throne of the High City: {4}, {T}, Sacrifice this land: You become the monarch.
- Sanctum of Eternity: {2}, {T}: Return target commander you own from the battlefield to your hand. Activate only
- Abstergo Entertainment: {3}, {T}, Exile ~: Return up to one target historic card from your graveyard to your hand,
- Clay Golem: {6}, Roll a d8: Monstrosity X, where X is the result.
- Decoction Module: {4}, {T}: Return target creature you control to its owner's hand.
- Homeward Path: {T}: Each player gains control of all creatures they own.
- Ingenuity Engine: {1}, {T}, Sacrifice an artifact: Return target artifact you control to its owner's hand.
- Iron Spider, Stark Upgrade: {T}: Put a +1/+1 counter on each artifact creature and/or Vehicle you control.
- Kayla's Music Box: {W}, {T}: Look at the top card of your library, then exile it face down.
- Kayla's Music Box: {T}: Until end of turn, you may play cards you own exiled with ~.
- Moggcatcher: {3}, {T}: Search your library for a Goblin permanent card, put it onto the battlefield, th
- Staff of Domination: {1}: Untap this artifact.
- Séance Board: {T}: Add X mana of any one color, where X is the number of soul counters on this artifact.
- The Animus: {T}: Until your next turn, target legendary creature you control becomes a copy of target 
- Bant Panorama: {1}, {T}, Sacrifice this land: Search your library for a basic Forest, Plains, or Island c
- Shinka, the Bloodsoaked Keep: {R}, {T}: Target legendary creature gains first strike until end of turn.
- Surveyor's Scope: {T}, Exile this artifact: Search your library for up to X basic land cards, where X is the
- Baxter Building: {4}, {T}: Add four mana in any combination of colors.
- Gate to the Afterlife: {2}, {T}, Sacrifice this artifact: Search your graveyard, hand, and/or library for a card 
- Razaketh, the Foulblooded: Pay 2 life, Sacrifice another creature: Search your library for a card, put that card into
- Access Tunnel: {3}, {T}: Target creature with power 3 or less can't be blocked this turn.
- Crucible of the Spirit Dragon: {1}, {T}: Put a storage counter on this land.
- Crucible of the Spirit Dragon: {T}, Remove X storage counters from this land: Add X mana in any combination of colors. Sp
- Lantern of Revealing: {4}, {T}: Look at the top card of your library. If it's a land card, you may put it onto t
- Nesting Grounds: {1}, {T}: Move a counter from target permanent you control onto a second target permanent.
- Desert: {T}: This land deals 1 damage to target attacking creature. Activate only during the end o
- Panoptic Projektor: {T}: The next face-down creature spell you cast this turn costs {3} less to cast.
- Zhao, the Moon Slayer: {7}: Put a conqueror counter on ~.
- Hua Tuo, Honored Physician: {T}: Put target creature card from your graveyard on top of your library. Activate only du
- Metalwork Colossus: Sacrifice two artifacts: Return this card from your graveyard to your hand.
- Maze's End: {3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put i
- Vhal, Candlekeep Researcher: {T}: Add an amount of {C} equal to ~'s toughness. This mana can't be spent to cast spells 
- Capenna Express: Sacrifice a Treasure: This Vehicle becomes an artifact creature until end of turn.
- Evolutionary Leap: {G}, Sacrifice a creature: Reveal cards from the top of your library until you reveal a cr

## Keywords seen (beyond the evergreen combat set)

- equip (139)
- enchant (67)
- mill (60)
- treasure (55)
- scry (49)
- crew (45)
- landfall (32)
- partner (23)
- food (23)
- kicker (19)
- cycling (16)
- fight (15)
- proliferate (15)
- choose a background (14)
- warp (13)
- investigate (13)
- connive (12)
- landwalk (12)
- flashback (12)
- convoke (11)
- ward (11)
- station (10)
- landcycling (10)
- typecycling (10)
- double (10)
- changeling (10)
- surveil (10)
- affinity (9)
- islandwalk (9)
- morph (9)
- monstrosity (8)
- basic landcycling (8)
- waterbend (8)
- regenerate (8)
- megamorph (7)
- encore (7)
- split second (7)
- imprint (7)
- ascend (6)
- madness (6)