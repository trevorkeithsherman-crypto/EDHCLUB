"""Sound: the designed sample palette (public/sfx) loads and plays through the engine — every cue has a file, repeats
rotate variants, rapid repeats collapse to one, volume is remembered, the Settings → Sound check panel lists and plays
every cue, and the old cue names still route to the new sounds. Run: python3 tests/sound.py <port>"""
import sys, json, os
sys.argv = ['x', sys.argv[1]]
src = open('tests/deep.py').read().split('with sync_playwright() as p:')[0]
exec(src)
man = json.load(open('public/sfx/manifest.json'))
files = [f for c in man['cues'].values() for f in c['files']]
check('manifest lists 23 cues with 35 files, every file shipped as ogg and mp3', len(man['cues']) == 23 and len(files) == 35 and all(os.path.exists(f'public/sfx/{f}.ogg') and os.path.exists(f'public/sfx/{f}.mp3') for f in files), f"{len(man['cues'])} {len(files)}")
check('repeating cues have round-robin variants (cards, taps, hits, attacks, shuffles)', all(len(man['cues'][c]['files']) >= 2 for c in ['card_slide', 'card_set', 'card_tap', 'shuffle', 'hit', 'attack', 'block']))
check('the whole palette is small enough to preload (under 1.5 MB of ogg)', sum(os.path.getsize(f'public/sfx/{f}.ogg') for f in files) < 1.5e6)
with sync_playwright() as p:
    browser = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required']); ctx = browser.new_context(); pg, errs = setup(ctx)
    pg.goto(BASE + '/table.html?mode=bots&name=Trevor&seats=2&bots=1'); pg.wait_for_timeout(1500)
    check('sound is on by default for a new table', pg.evaluate("__edhState().sound") is True)
    pg.mouse.click(400, 300); pg.wait_for_timeout(200)
    pg.wait_for_function("() => { const a = window.__edhSfx && window.__edhSfx(); return a && a.state !== 'loading' && a.state !== 'idle'; }", timeout=20000)
    st = pg.evaluate("() => { const a = __edhSfx(); return { state: a.state, cues: Object.keys(a.buffers).length, missing: Object.entries(a.buffers).filter(([k, v]) => !v.length).map(([k]) => k), vol: a.master.gain.value, comp: !!a.comp, hit: a.buffers.hit && a.buffers.hit.map((b) => +b.duration.toFixed(2)), ch: a.buffers.hit && a.buffers.hit[0].numberOfChannels, sr: a.buffers.hit && a.buffers.hit[0].sampleRate }; }")
    check('first click starts the engine and every cue decodes (stereo 48 kHz buffers through a compressor)', st['state'] == 'ready' and st['cues'] == 23 and not st['missing'] and st['comp'] and st['ch'] == 2 and st['sr'] in (48000, 44100), json.dumps(st))
    check('a hit is a short heavy sample, not a 2-second tone', st['hit'] and all(0.6 <= d <= 1.4 for d in st['hit']), str(st['hit']))
    r = pg.evaluate("() => { const a = __edhSfx(); const first = a.play('tap', null, { force: true }); const rr1 = a.rr.card_tap; a.play('tap', null, { force: true }); const rr2 = a.rr.card_tap; return [first, rr1, rr2]; }")
    check('plays from samples and rotates variants on repeats', r[0] is True and r[1] != r[2], str(r))
    r = pg.evaluate("() => { const a = __edhSfx(); const x = a.play('hit'); const y = a.play('hit'); return [x, y]; }")
    check('the same cue twice inside 45 ms is one event (board wipes / untap-all don\'t machine-gun)', r == [True, False], str(r))
    r = pg.evaluate("() => { const a = __edhSfx(); return [a.resolve('chime', 'R'), a.resolve('whoosh'), a.resolve('thud'), a.resolve('fanfare'), a.resolve('shatter'), a.resolve('gong'), a.resolve('tick'), a.resolve('turn'), a.resolve('chime', 'X')]; }")
    check('legacy cue names route to the new palette', r == ['cast_R', 'card_slide', 'card_set', 'commander', 'counter', 'eliminated', 'card_tap', 'your_turn', 'cast_C'], str(r))
    # settings → sound check
    pg.click('#settingsBtn'); pg.wait_for_timeout(200); pg.locator('.menu .mi:has-text("Sound check")').click(); pg.wait_for_timeout(600)
    check('Sound check panel lists every cue with a play button and a volume slider', pg.locator('.snd-row [data-snd]').count() == 23 and pg.locator('#sndVol').count() == 1 and 'Sounds loaded' in pg.locator('#sndState').text_content())
    pg.locator('.snd-row [data-snd="cast_U"]').click(); pg.locator('.snd-row [data-snd="eliminated"]').click(); pg.wait_for_timeout(100)
    check('play buttons play (no errors)', not errs, str(errs)[:200])
    pg.evaluate("() => { const s = document.getElementById('sndVol'); s.value = 0.3; s.dispatchEvent(new Event('input', { bubbles: true })); }"); pg.wait_for_timeout(200)
    check('volume slider sets the master bus and is remembered', abs(pg.evaluate("__edhSfx().vol") - 0.3) < 0.01 and pg.evaluate("localStorage.getItem('edhclub-vol')") == '0.3')
    pg.click('#modal [data-act=close]'); pg.reload(); pg.wait_for_timeout(1200); pg.mouse.click(400, 300); pg.wait_for_timeout(300)
    check('…after a reload the engine starts at the remembered volume', abs(pg.evaluate("__edhSfx().vol") - 0.3) < 0.01)
    # in-game triggers route to the right cues
    pg.wait_for_function("() => __edhSfx().state === 'ready'", timeout=20000)
    pg.evaluate("() => { const a = __edhSfx(); a._log = []; const orig = a.play.bind(a); a.play = (n, arg, o) => { a._log.push(a.resolve(n, arg)); return orig(n, arg, o); }; }")
    hid = pg.evaluate("__edhState().players[0].zones.hand[0]"); pg.evaluate(f"__edhApi().moveCard('{hid}', 0, 'battlefield', {{ anim: 'land' }})"); pg.wait_for_timeout(700)
    pg.evaluate(f"__edhState().cards['{hid}'] && __edhMut(st => {{}})")
    bf = pg.evaluate("__edhState().players[0].zones.battlefield[0]")
    b = pg.locator(f'.card[data-id="{bf}"]').bounding_box(); pg.mouse.click(b['x'] + b['width'] / 2, b['y'] + b['height'] / 2); pg.wait_for_timeout(400)
    pg.evaluate("__edhApi().net; __edhMut(st => { st.players[0].life -= 3; })")
    log = pg.evaluate("__edhSfx()._log")
    check('playing a land and tapping a card use the card sounds (set down, tap)', 'card_set' in log and 'card_tap' in log, str(log))
    check('no JS errors', not errs, str(errs)[:300])
    browser.close()
fails = [r for r in results if not r[1]]
print(f'\n{len(results) - len(fails)}/{len(results)} passed')
for n, ok, note in fails: print('  FAIL', n, note)
