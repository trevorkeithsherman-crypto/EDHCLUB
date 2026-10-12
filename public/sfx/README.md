# Table sounds

Every cue the table plays lives here as a stereo 48 kHz file (`.ogg` for Chrome/Firefox/Edge, `.mp3` for Safari).
`manifest.json` maps cue → files; cues with several files are played round-robin with a little random pitch so
repeats never sound mechanical. The engine is `SFX` in `src/fx.js`; the palette is rendered by `tools/sfx/build.py`.

| Cue | When | Design |
|---|---|---|
| `card_slide` ×3 | draw, move between zones | paper hiss with a flex resonance, dry, close |
| `card_set` ×2 | land / permanent put down | short slide, felt-damped tap, wooden table under it |
| `card_tap` ×3 | tap / untap | fingertip turning a card: tiny and dry |
| `shuffle` ×2 | shuffle, mulligan | two accelerating riffles, then the deck squared up |
| `card_flip` ×2 | transform, face down | a paper flick |
| `token` ×2 | token / copy created | breath of air and a small glass bell |
| `cast_W U B R G C` | spell cast (by colour) | air swell + bell; W shimmers, U wobbles like water, B breathes with a sub, R crackles, G knocks like wood |
| `counter` | spell countered | glass: crack, shard cloud, ring, weight on the floor |
| `commander` | commander enters | timpani + a brass swell opening in a hall |
| `attack` ×2 | attack declared | blade drawn: whoosh crossing the stereo field, steel ring |
| `block` ×2 | blocker assigned | a shield taking the blow: wood body, a little steel |
| `hit` ×2 | life lost / damage | sub drop, body, crack, debris, a room |
| `heal` | life gained | warm chord blooming with light on top |
| `your_turn` | it becomes your turn | low drum and a rising shimmer |
| `message` | chat | a soft wooden note |
| `ui_tick` ×2 | counters, small controls | barely there |
| `eliminated` | a player is out | a large gong: strike then bloom, partials beating |
| `victory` | the game is won | brass phrase over a timpani roll, cymbal swell |

## Replacing a sound with a recording

Drop a file with the same base name here (`hit1.ogg` + `hit1.mp3`, say) and it is used without any code change.
Keep peaks around the levels in the table above family: impacts −1…−4 dBFS, card handling −6…−10, ticks −16…−20.
Free, licence-clean sources that fit this palette: Kenney *Casino Audio* and *Impact Sounds* (CC0), the Sonniss
GDC bundles (royalty-free), and Freesound filtered to CC0 (search "card slide felt", "riffle shuffle", "sword unsheathe",
"body fall impact", "tam-tam", "glass shatter small", "orchestral brass stab"). Re-run `python3 tools/sfx/build.py`
to regenerate the designed set.
