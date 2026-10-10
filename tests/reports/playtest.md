# Bot playtest report

2 four-bot games with generated Commander decks (real oracle text from the card database).

| game | commanders | turns | result | casts | attacks | state problems | JS errors |
|---|---|---|---|---|---|---|---|
| 3 | Shalai, Voice of Plenty, Fortune, Loyal Steed, Wernog, Rider's Chaplain, Inquisitor Eisenhorn | 15 | won by Lich Bot | 29 | 58 | 0 | 0 |
| 4 | Erinis, Gloom Stalker, Rosnakht, Heir of Rohgahh, Seshiro the Anointed, Kellogg, Dangerous Mind | 15 | won by Druid Bot | 27 | 52 | 0 | 0 |

Cards whose text the interpreter handled: **226**. Triggers still left to the table (auto vs manual, from the logs):

- auto: Deep Gnome Terramancer: 13
- auto: Rosnakht, Heir of Rohgahh: 7
- manual: Fortune, Loyal Steed: 5
- auto: Crawling Infestation: 5
- auto: Aether Vial: 5
- auto: Chronicle of Victory: 5
- manual: Erinis, Gloom Stalker: 5
- auto: Kellogg, Dangerous Mind: 4
- auto: Monument: 4
- manual: Bane of Bala Ged: 4
- auto: Gate to the Afterlife: 3
- auto: Fortune, Loyal Steed: 2
- manual: Fey Steed: 1
- auto: Extraplanar Lens: 1
- manual: Foreboding Steamboat: 1
- manual: Star Pupil: 1
- manual: Malakir Bloodwitch: 1
- auto: Chaplain: 1
- auto: Overseer of Vault 76: 1
- manual: Champion of the Clachan: 1
- manual: Druid Bot's The Revelations of Ezio chapter III: III — Return target Assassin creature card from your graveyard to the battlefiel — resolve by hand: 1
- manual: Druid Bot's Summon: Kujata chapter II: II — Ice — Up to three target creatures can't block this turn. — resolve by hand: 1
- auto: Powder Ganger: 1
- auto: graveyard (3), 1 Insect token: 1
- manual: Sphinx Bot's Summon: Kujata chapter I: I — Lightning — This creature deals 3 damage to each of up to two target creatur — resolve by hand: 1
- auto: Seraph Sanctuary: 1

## Trigger text not understood (resolve by hand)

- Relic Axe: When this Equipment enters, attach it to target creature you control.
- Anafenza, Kin-Tree Spirit: Whenever another nontoken creature you control enters, bolster 1.
- Ardenn, Intrepid Archaeologist: At the beginning of combat on your turn, you may attach any number of Auras and Equipment 
- Armory Automaton: Whenever this creature enters or attacks, you may attach any number of target Equipment to
- Ascend from Avernus (spell): no effect understood
- Avatar's Wrath (spell): no effect understood
- Chalice of the Void: Whenever a player casts a spell with mana value equal to the number of charge counters on 
- Champion of the Clachan: When this creature leaves the battlefield, return the exiled card to its owner's hand.
- Conundrum Sphinx: Whenever this creature attacks, each player chooses a card name. Then each player reveals 
- Currency Converter: Whenever you discard a card, you may exile that card from your graveyard.
- Cyberdrive Awakener: When this creature enters, each noncreature artifact you control becomes a 4/4 artifact cr
- Davriel, Rogue Shadowmage: At the beginning of each opponent's upkeep, if that player has one or fewer cards in hand,
- Divine Reckoning (spell): no effect understood
- Eldritch Immunity (spell): no effect understood
- Felidar Retreat: Whenever a land you control enters, choose one —
- Fell Shepherd: Whenever this creature deals combat damage to a player, you may return to your hand all cr
- Fey Steed: Whenever this creature attacks, another target attacking creature you control gains indest
- Foreboding Steamboat: When this Vehicle enters, each player chooses two nontoken, non-Vehicle creatures they con
- Fortune, Loyal Steed: Whenever ~ attacks while saddled, at end of combat, exile it and up to one creature that s
- From the Rubble: At the beginning of your end step, return target creature card of the chosen type from you
- Geometric Nexus: Whenever a player casts an instant or sorcery spell, put a number of charge counters on th
- Getaway Car: Whenever this Vehicle attacks or blocks, return up to one target creature that crewed it t
- Glider Staff: When this Equipment enters, airbend up to one target creature.
- Goliath Truck: Whenever this Vehicle attacks, put two +1/+1 counters on another target attacking creature
- Ironwill Forger: At the beginning of combat on your turn, if you control your commander, target nonlegendar
- Jar of Eyeballs: Whenever a creature you control dies, put two eyeball counters on this artifact.
- Junk Diver: When this creature dies, return another target artifact card from your graveyard to your h
- Leonin Relic-Warder: When this creature leaves the battlefield, return the exiled card to the battlefield under
- Malakir Bloodwitch: When this creature enters, each opponent loses life equal to the number of Vampires you co
- Mystic Barrier: When this enchantment enters and at the beginning of your upkeep, choose left or right.
- Nekrataal: When this creature enters, destroy target nonartifact, nonblack creature. That creature ca
- Patch Up (spell): no effect understood
- Pianna, Nomad Captain: Whenever ~ attacks, attacking creatures get +1/+1 until end of turn.
- Razor Rings (spell): no effect understood
- Scaretiller: Whenever this creature becomes tapped, choose one —
- Scion of Darkness: Whenever this creature deals combat damage to a player, you may put target creature card f
- Scourge of the Undercity: When this creature enters, another target creature you control gains lifelink until end of
- Scout for Survivors (spell): no effect understood
- Specimen Freighter: When this Spacecraft enters, return up to two target non-Spacecraft creatures to their own
- Star Pupil: When this creature dies, put its counters on target creature you control.
- Starfield of Nyx: At the beginning of your upkeep, you may return target enchantment card from your graveyar
- Stoic Farmer: When this creature enters, search your library for a basic Plains card and reveal it. If a
- Strata Scythe: When this Equipment enters, search your library for a land card, exile it, then shuffle.
- Sudden Substitution (spell): no effect understood
- Sunstar Expansionist: When this creature enters, if an opponent controls more lands than you, create a Lander to
- Tomb of Horrors Adventurer: When this creature enters, you take the initiative.
- Tomb of Horrors Adventurer: Whenever you cast your second spell each turn, copy it. If you've completed a dungeon, cop
- Trove Warden: When this creature dies, put each permanent card exiled with it onto the battlefield under
- Twilight Shepherd: When this creature enters, return to your hand all cards in your graveyard that were put t
- Vicious Battlerager: When this creature enters, you take the initiative.
- Vicious Battlerager: Whenever this creature becomes blocked by a creature, that creature's controller loses 5 l
- Animist's Awakening (spell): no effect understood
- Bane of Bala Ged: Whenever this creature attacks, defending player exiles two permanents they control.
- Berserker's Frenzy (spell): no effect understood
- Blightwing Bandit: Whenever you cast your first spell during each opponent's turn, look at the top card of th
- Bloodline Necromancer: When this creature enters, you may return target Vampire or Wizard creature card from your
- Bribe Taker: When this creature enters, for each kind of counter on permanents you control, you may put
- Brooding Saurian: At the beginning of each end step, each player gains control of all nontoken permanents th
- Cleanup Crew: When this creature enters, choose one —
- Court of Ire: When this enchantment enters, you become the monarch.
- Day of Black Sun (spell): no effect understood
- Duchess, Wayward Tavernkeep: Whenever a creature you control deals combat damage to a player, put a quest counter on it
- Earth Tremor (spell): no effect understood
- Enchanter's Bane: At the beginning of your end step, target enchantment deals damage equal to its mana value
- Erinis, Gloom Stalker: Whenever ~ attacks, return target land card from your graveyard to the battlefield.
- Flamekin Harbinger: When this creature enters, you may search your library for an Elemental card, reveal it, t
- Goblin Ringleader: When this creature enters, reveal the top four cards of your library. Put all Goblin cards
- Great Oak Guardian: When this creature enters, creatures target player controls get +2/+2 until end of turn. U
- Kari Zev, Skyship Raider: Whenever ~ attacks, create Ragavan, a legendary 2/1 red Monkey creature token. Ragavan ent
- Mulch (spell): no effect understood
- Nalfeshnee: Whenever you cast a spell from exile, copy it. You may choose new targets for the copy. If
- Oath of Druids: At the beginning of each player's upkeep, that player chooses target player who controls m
- Oran-Rief Ooze: Whenever this creature attacks, put a +1/+1 counter on each attacking creature with a +1/+
- Past in Flames (spell): no effect understood
- Pull Through the Weft (spell): no effect understood
- Replicating Ring: At the beginning of your upkeep, put a night counter on this artifact. Then if it has eigh
- Scrounging Bandar: At the beginning of your upkeep, you may move any number of +1/+1 counters from this creat
- Selective Adaptation (spell): no effect understood
- Sizzling Soloist: Whenever another creature you control enters, target creature an opponent controls can't b
- Skyclave Relic: When this artifact enters, if it was kicked, create two tapped tokens that are copies of t

## Activated abilities not understood

- Adaptive Training Post: Remove three charge counters from this artifact: When you next cast an instant or sorcery 
- Bighorner Rancher: {T}: Add an amount of {G} equal to the greatest power among creatures you control.
- Bighorner Rancher: Sacrifice this creature: You gain life equal to the greatest toughness among other creatur
- Bucknard's Everfull Purse: {1}, {T}: Roll a d4 and create a number of Treasure tokens equal to the result. The player
- Eiganjo Castle: {W}, {T}: Prevent the next 2 damage that would be dealt to target legendary creature this 
- Haven of the Spirit Dragon: {2}, {T}, Sacrifice this land: Return target Dragon creature card or Ugin planeswalker car
- Hostile Desert: {2}, Exile a land card from your graveyard: This land becomes a 3/4 Elemental creature unt
- Karakas: {T}: Return target legendary creature to its owner's hand.
- Lantern of Revealing: {4}, {T}: Look at the top card of your library. If it's a land card, you may put it onto t
- Mage-Ring Network: {1}, {T}: Put a storage counter on this land.
- Maraleaf Rider: Sacrifice a Food: Target creature blocks this creature this turn if able.
- Razaketh, the Foulblooded: Pay 2 life, Sacrifice another creature: Search your library for a card, put that card into
- Renowned Weaponsmith: {U}, {T}: Search your library for a card named Heart-Piercer Bow or Vial of Dragonfire, re
- Rikku, Resourceful Guardian: {1}, {T}: Move a counter from target creature an opponent controls onto target creature yo
- Scholar of New Horizons: {T}, Remove a counter from a permanent you control: Search your library for a Plains card 
- Smelting Vat: {1}, {T}, Sacrifice another artifact: Reveal the top eight cards of your library. Put up t
- Surveyor's Scope: {T}, Exile this artifact: Search your library for up to X basic land cards, where X is the
- Underdark Rift: {5}, {T}, Exile this land: Roll a d10. Put target artifact, creature, or planeswalker into
- Unlicensed Hearse: {T}: Exile up to two target cards from a single graveyard.
- Vhal, Candlekeep Researcher: {T}: Add an amount of {C} equal to ~'s toughness. This mana can't be spent to cast spells 
- Access Tunnel: {3}, {T}: Target creature with power 3 or less can't be blocked this turn.
- Accursed Duneyard: {2}, {T}: Regenerate target Shade, Skeleton, Specter, Spirit, Vampire, Wraith, or Zombie.
- Aeon Engine: {T}, Exile this artifact: Reverse the game's turn order.
- Aether Vial: {T}: You may put a creature card with mana value equal to the number of charge counters on
- Baldur's Gate: {2}, {T}: Add X mana of any one color, where X is the number of other Gates you control.
- Conduit of Worlds: {T}: Choose target nonland permanent card in your graveyard. If you haven't cast a spell t
- Gate to the Afterlife: {2}, {T}, Sacrifice this artifact: Search your graveyard, hand, and/or library for a card 
- Heartless Hidetsugu: {T}: ~ deals damage to each player equal to half that player's life total, rounded down.
- Izzet Chemister: {R}, {T}: Exile target instant or sorcery card from your graveyard.
- Maze's End: {3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put i
- Mogg Assassin: {T}: You choose target creature an opponent controls, and that opponent chooses target cre
- Oblivion Stone: {4}, {T}: Put a fate counter on target permanent.
- Oran-Rief, the Vastwood: {T}: Put a +1/+1 counter on each green creature that entered this turn.
- Otepec Huntmaster: {T}: Target Dinosaur gains haste until end of turn.
- Relic of Progenitus: {T}: Target player exiles a card from their graveyard.
- Scroll Rack: {1}, {T}: Exile any number of cards from your hand face down. Put that many cards from the
- The Chain Veil: {4}, {T}: For each planeswalker you control, you may activate one of its loyalty abilities
- Zhao, the Moon Slayer: {7}: Put a conqueror counter on ~.

## Keywords seen that the combat engine does not model

- equip (25)
- mill (16)
- treasure (10)
- crew (10)
- scry (9)
- landfall (6)
- investigate (6)
- partner (5)
- enchant (5)
- flashback (5)
- choose a background (4)
- cycling (3)
- split second (3)
- kicker (3)
- regenerate (3)
- food (3)
- basic landcycling (2)
- landcycling (2)
- typecycling (2)
- airbend (2)
- morph (2)
- warp (2)
- imprint (2)
- battle cry (2)
- ascend (2)
- lieutenant (2)
- infect (2)
- station (2)
- ward (2)
- fight (2)
- raid (2)
- dredge (2)
- explore (2)
- alliance (2)
- outlast (1)
- bolster (1)
- devoid (1)
- genomic enhancement (1)
- spectacle (1)
- behold (1)

## State invariant problems

- none