"""EDH Club sound palette — designed, not bleeped.

Renders every table cue as 48 kHz stereo audio into public/sfx/ (ogg + mp3), with 2–3 round-robin variants where a cue
repeats often. Every sound is built the way a sound designer layers a cue: a transient (the attack you feel), a body
(what it is: paper, felt, metal, glass, brass, skin) and a tail (the room it happens in), then levelled per family so
impacts sit above card handling and card handling above ticks.

Run: python3 tools/sfx/build.py          (needs numpy, scipy, ffmpeg)
Drop-in replacements: any file in public/sfx/ can be swapped for a recorded one with the same name; the engine only
cares about the names in MANIFEST below (which is also written to public/sfx/manifest.json)."""
import json, os, subprocess, sys
import numpy as np
from scipy import signal

SR = 48000
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'sfx')
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- primitives
def t(n): return np.arange(n) / SR
def sec(s): return int(SR * s)
def silence(s): return np.zeros(sec(s))
def noise(s): return rng.standard_normal(sec(s))
def sine(f, s, phase=0.0): return np.sin(2 * np.pi * f * t(sec(s)) + phase)
def expdecay(s, tau): x = t(sec(s)); return np.exp(-x / tau)
def env_ad(n, a, d, curve=3.0):
    """attack a seconds (linear), then exponential-ish decay reaching ~0 by d seconds"""
    na, nd = max(1, sec(a)), max(1, sec(d)); e = np.zeros(n)
    e[:min(na, n)] = np.linspace(0, 1, min(na, n))
    k = np.arange(min(nd, max(0, n - na))); e[na:na + len(k)] = np.exp(-curve * k / nd)
    return e
def tailfade(x, ms=8):
    """every layer ends with a short fade so an unfinished decay never becomes a click"""
    x = x.copy(); f = min(sec(ms / 1000), len(x) // 2)
    if f > 1:
        if x.ndim == 2: x[-f:] *= np.linspace(1, 0, f)[:, None]
        else: x[-f:] *= np.linspace(1, 0, f)
    return x
def fit(x, n):
    x = tailfade(x)
    if len(x) >= n: return tailfade(x[:n])
    return np.concatenate([x, np.zeros(n - len(x))])
def mix(*layers):
    n = max(len(l) for l in layers); return sum(fit(l, n) for l in layers)
def at(x, when, total=None):
    """place x starting at `when` seconds (mono or stereo)"""
    if x.ndim == 2: out = np.concatenate([np.zeros((sec(when), 2)), x]); return fit2(out, sec(total)) if total else out
    out = np.concatenate([np.zeros(sec(when)), x]); return fit(out, sec(total)) if total else out
def butter(x, f, kind, order=2):
    f = np.clip(np.atleast_1d(f), 20, SR / 2 - 100); f = float(f[0]) if len(f) == 1 else f
    sos = signal.butter(order, f, kind, fs=SR, output='sos'); return signal.sosfilt(sos, x)
def lowpass(x, f, order=2): return butter(x, f, 'lowpass', order)
def highpass(x, f, order=2): return butter(x, f, 'highpass', order)
def bandpass(x, lo, hi, order=2): return butter(x, [lo, hi], 'bandpass', order)
def peak(x, f, q, gain_db):
    b, a = signal.iirpeak(min(f, SR / 2 - 100), q, fs=SR); y = signal.lfilter(b, a, x); return x + (10 ** (gain_db / 20) - 1) * y
def _sweep(x, f0, f1, steps, fn):
    """time-varying filter by overlap-add of triangular-windowed segments (constant overlap-add, so no seams)"""
    n = len(x); hop = max(1, n // steps); out = np.zeros(n + 2 * hop); xp = np.concatenate([np.zeros(hop), x, np.zeros(2 * hop)])
    win = np.bartlett(2 * hop)
    for i in range(steps + 1):
        a = i * hop; seg = xp[a:a + 2 * hop]
        if len(seg) < 2 * hop: break
        fc = f0 * (f1 / f0) ** (i / steps); out[a:a + 2 * hop] += fn(seg, fc) * win
    return out[hop:hop + n]
def sweep_bandpass(x, f0, f1, bw=1.0, steps=24):
    """centre frequency glides f0 → f1 (log), bandwidth in octaves"""
    return _sweep(x, f0, f1, steps, lambda seg, fc: bandpass(seg, fc / 2 ** (bw / 2), min(fc * 2 ** (bw / 2), SR / 2 - 200)))
def sweep_lowpass(x, f0, f1, steps=20): return _sweep(x, f0, f1, steps, lambda seg, fc: lowpass(seg, fc))
def saturate(x, drive=1.5): return np.tanh(x * drive) / np.tanh(drive)
def modal(partials, s, strike=0.004):
    """sum of decaying sines: partials = [(freq, amp, decay_seconds), ...], with a soft strike onset"""
    s = min(max(s, 3.2 * max(d for _, _, d in partials)), 7.0); n = sec(s); out = np.zeros(n)
    for f, a, d in partials:
        f2 = f * (1 + rng.normal(0, 0.0015)); out += a * np.sin(2 * np.pi * f2 * t(n) + rng.uniform(0, 6.28)) * np.exp(-t(n) / d)
    out *= env_ad(n, strike, s, curve=0.0001)  # soft onset only
    return out
def grains(s, count, dur, lo, hi, shape='click', accel=0.0):
    """scatter `count` short filtered noise grains over s seconds (riffles, debris, glass)"""
    n = sec(s); out = np.zeros(n)
    pos = np.sort(rng.uniform(0, 1, count) ** (1 + accel))
    for p in pos:
        g = noise(dur) * env_ad(sec(dur), 0.0005, dur, 4)
        f = np.exp(rng.uniform(np.log(lo), np.log(hi))); g = bandpass(g, f / 1.4, min(f * 1.4, SR / 2 - 200))
        start = int(p * (n - len(g))); out[start:start + len(g)] += g * rng.uniform(0.5, 1)
    return out
def make_ir(rt60, predelay=0.012, bright=0.5, stereo=True):
    """synthetic hall: exponentially decaying noise, highs decaying faster than lows"""
    n = sec(rt60 * 1.2); outs = []
    for ch in range(2 if stereo else 1):
        x = rng.standard_normal(n)
        lo = lowpass(x, 400) * np.exp(-6.9 * t(n) / rt60)
        mid = bandpass(x, 400, 3000) * np.exp(-6.9 * t(n) / (rt60 * 0.75))
        hi = highpass(x, 3000) * np.exp(-6.9 * t(n) / (rt60 * (0.35 + 0.3 * bright)))
        ir = lo + mid + hi * (0.4 + bright)
        ir[:sec(0.004)] *= np.linspace(0, 1, sec(0.004))
        outs.append(at(ir, predelay))
    ir = np.stack(outs if stereo else outs * 2, axis=1); return ir / np.sqrt(np.sum(ir ** 2, axis=0).max())
def reverb(x, rt60=1.4, wet=0.25, predelay=0.012, bright=0.5):
    """x mono (n,) or stereo (n,2) → stereo with a hall tail"""
    x2 = to_stereo(x); ir = make_ir(rt60, predelay, bright)
    wetsig = np.stack([signal.fftconvolve(x2[:, c], ir[:, c])[:len(x2) + len(ir)] for c in range(2)], axis=1)
    dry = fit2(x2, len(wetsig)); return tailfade(dry * (1 - wet * 0.5) + wetsig * wet, 20)
def to_stereo(x, width=0.0):
    if x.ndim == 2: return x
    if width <= 0: return np.stack([x, x], axis=1)
    d = sec(0.0004 * width); return np.stack([x, np.concatenate([np.zeros(d), x[:-d]]) if d else x], axis=1)
def fit2(x, n): x = tailfade(x); return tailfade(x[:n]) if len(x) >= n else np.concatenate([x, np.zeros((n - len(x), x.shape[1]))])
def pan(x, p):
    """constant-power pan, p in [-1, 1]"""
    x2 = to_stereo(x); a = (p + 1) / 2 * np.pi / 2; return np.stack([x2[:, 0] * np.cos(a), x2[:, 1] * np.sin(a)], axis=1)
def move(x, p0, p1):
    """pan glides p0 → p1 across the sound (whooshes)"""
    x2 = to_stereo(x); n = len(x2); p = np.linspace(p0, p1, n); a = (p + 1) / 2 * np.pi / 2
    return np.stack([x2[:, 0] * np.cos(a), x2[:, 1] * np.sin(a)], axis=1)
def finish(x, peak_db, tail=0.03, hp=30):
    """stereo, DC-free, gentle fades, normalised to peak_db"""
    x2 = to_stereo(x).astype(np.float64)
    for c in range(2): x2[:, c] = highpass(x2[:, c], hp, 1)
    n = len(x2); f = min(sec(tail), n // 4)
    if f > 1: x2[-f:] *= np.linspace(1, 0, f)[:, None]
    x2[:sec(0.001)] *= np.linspace(0, 1, sec(0.001))[:, None]
    pk = np.abs(x2).max() or 1; x2 *= 10 ** (peak_db / 20) / pk
    # trim silence at the end (below -72 dB)
    mag = np.abs(x2).max(axis=1); keep = np.nonzero(mag > 10 ** (-54 / 20))[0]
    end = min(n, (keep[-1] if len(keep) else n) + sec(0.02)); return x2[:end]
def pitch(x, semis):
    """resample for small pitch/speed shifts (variants)"""
    r = 2 ** (-semis / 12); n = int(len(x) * r)
    if x.ndim == 1: return signal.resample(x, n)
    return np.stack([signal.resample(x[:, c], n) for c in range(2)], axis=1)

# ---------------------------------------------------------------- the palette
def card_slide(v):
    """a card drawn / slid across the table: paper hiss with a flex resonance, dry and close"""
    d = [0.17, 0.21, 0.14][v]
    hiss = sweep_bandpass(noise(d), 4200, 1500, bw=1.6) * env_ad(sec(d), 0.012, d, 2.2)
    flex = peak(noise(0.05) * env_ad(sec(0.05), 0.001, 0.05, 5), 2600 + v * 300, 12, 18) * 0.5
    snap = highpass(noise(0.012) * env_ad(sec(0.012), 0.0003, 0.012, 6), 3000) * 0.9
    x = mix(hiss * 0.9, at(flex, d * 0.55), at(snap, d * 0.6))
    return finish(reverb(pan(x, rng.uniform(-0.25, 0.25)), 0.5, 0.08, 0.006, 0.3), -10)
def card_set(v):
    """a permanent set down on felt: a short paper slide, then a felt-damped tap with a wooden table under it"""
    slide = sweep_bandpass(noise(0.07), 3000, 1200, 1.4) * env_ad(sec(0.07), 0.01, 0.07, 3) * 0.35
    tap = lowpass(noise(0.03) * env_ad(sec(0.03), 0.0005, 0.03, 5), 900) * 1.0
    table = modal([(95 - v * 6, 1.0, 0.05), (190, 0.35, 0.03), (310, 0.2, 0.02)], 0.25, 0.001) * 0.5
    x = mix(slide, at(tap, 0.055), at(table, 0.055))
    return finish(reverb(pan(x, rng.uniform(-0.2, 0.2)), 0.6, 0.12, 0.008, 0.25), -6)
def card_tap(v):
    """tap / untap: a fingertip turning a card — tiny, dry, no ring"""
    click = highpass(noise(0.008) * env_ad(sec(0.008), 0.0002, 0.008, 6), 1800 + v * 400) * 0.8
    body = lowpass(noise(0.02) * env_ad(sec(0.02), 0.0005, 0.02, 5), 600) * 0.6
    paper = peak(noise(0.03) * env_ad(sec(0.03), 0.002, 0.03, 4), 3200 + v * 500, 10, 14) * 0.3
    return finish(pan(mix(click, body, at(paper, 0.004)), rng.uniform(-0.15, 0.15)), -16)
def shuffle(v):
    """a riffle shuffle: two bursts of accelerating card ticks, then the deck squared up on the table"""
    def riffle(s, count): return grains(s, count, 0.006, 1800, 5200, accel=0.6) * env_ad(sec(s), 0.02, s, 1.2)
    x = mix(riffle(0.32, 46), at(riffle(0.3, 42), 0.36), at(lowpass(noise(0.3), 500) * env_ad(sec(0.3), 0.01, 0.3, 2) * 0.25, 0.02))
    square = mix(lowpass(noise(0.03) * env_ad(sec(0.03), 0.0005, 0.03, 5), 1200), modal([(110, 1, 0.07), (220, 0.3, 0.04)], 0.2, 0.001))
    x = mix(x, at(square * 0.9, 0.74), at(square * 0.6, 0.80))
    return finish(reverb(to_stereo(x, 0.6), 0.6, 0.12, 0.008, 0.3), -7)
def card_flip(v):
    """transform / face down: a quick paper flick"""
    flick = sweep_bandpass(noise(0.09), 900, 4200, 1.5) * env_ad(sec(0.09), 0.004, 0.09, 3)
    snap = highpass(noise(0.01) * env_ad(sec(0.01), 0.0003, 0.01, 6), 2500) * 0.9
    return finish(reverb(pan(mix(flick * 0.8, at(snap, 0.035)), rng.uniform(-0.2, 0.2)), 0.5, 0.1, 0.006, 0.3), -9)
def token(v):
    """a token conjured: a breath of air and a small glass bell"""
    air = sweep_bandpass(noise(0.4), 500, 2600, 1.8) * env_ad(sec(0.4), 0.12, 0.4, 3) * 0.5
    bell = modal([(2093, 1, 0.5), (3400, 0.5, 0.35), (5600, 0.25, 0.2), (1046, 0.3, 0.6)], 0.9, 0.002) * 0.6
    return finish(reverb(mix(air, at(bell, 0.1)), 1.6, 0.35, 0.015, 0.6), -11)

BELL = [(1.0, 1.0, 1.0), (2.0, 0.55, 0.7), (2.76, 0.45, 0.5), (3.9, 0.3, 0.4), (5.4, 0.2, 0.28), (8.9, 0.08, 0.18)]
def cast(color):
    """a spell cast, coloured by its mana: a swell of air and a bell whose metal depends on the colour"""
    base = {'W': 880, 'U': 659, 'B': 196, 'R': 440, 'G': 330, 'C': 523}[color]
    dec = {'W': 1.2, 'U': 1.3, 'B': 1.4, 'R': 0.9, 'G': 0.7, 'C': 1.1}[color]
    parts = [(base * r, a, dec * d) for r, a, d in BELL]
    bell = modal(parts, 2.4, 0.003)
    air = sweep_bandpass(noise(0.5), 400, 3000, 2.0) * env_ad(sec(0.5), 0.2, 0.5, 4) * 0.45
    layers = [bell, air]
    if color == 'W': layers.append(at(grains(0.8, 40, 0.01, 4000, 9000) * env_ad(sec(0.8), 0.05, 0.8, 2) * 0.25, 0.1))   # shimmer
    if color == 'U': layers.append(sine(base / 2, 1.6) * (0.5 + 0.5 * np.sin(2 * np.pi * 5.5 * t(sec(1.6)))) * env_ad(sec(1.6), 0.05, 1.6, 3) * 0.2)   # watery wobble
    if color == 'B': layers.append(mix(lowpass(noise(1.2), 350) * env_ad(sec(1.2), 0.15, 1.2, 3) * 0.5, sine(base / 2, 1.4) * env_ad(sec(1.4), 0.03, 1.4, 3) * 0.3))   # breath + sub
    if color == 'R': layers.append(at(saturate(grains(0.6, 70, 0.008, 900, 5000) * env_ad(sec(0.6), 0.02, 0.6, 2.5), 3) * 0.35, 0.05))   # fire crackle
    if color == 'G': layers.append(modal([(base * 0.5, 1, 0.25), (base * 0.5 * 2.3, 0.5, 0.12)], 0.6, 0.002) * 0.7)   # wood knock
    x = mix(*layers)
    return finish(reverb(to_stereo(x, 0.8), 2.0 if color != 'G' else 1.2, 0.4, 0.02, 0.6 if color in 'WU' else 0.35), -6)
def counter_shatter(v):
    """a spell countered: glass breaking — a crack, a cloud of shards, the weight of it on the floor"""
    crack = highpass(noise(0.015) * env_ad(sec(0.015), 0.0002, 0.015, 5), 1500) * 1.2
    shards = grains(0.5, 90, 0.012, 2500, 11000, accel=0.9) * env_ad(sec(0.5), 0.005, 0.5, 2.2)
    ring = modal([(3100, 0.5, 0.35), (4700, 0.35, 0.25), (7200, 0.2, 0.15), (9400, 0.12, 0.12)], 0.6, 0.001) * 0.6
    knock = modal([(120, 1, 0.12), (240, 0.3, 0.06)], 0.3, 0.001) * 0.9
    x = mix(crack, at(shards, 0.01), at(ring, 0.005), knock)
    return finish(reverb(to_stereo(x, 1.0), 1.4, 0.3, 0.015, 0.7), -3)
def brass(freqs, s, attack, release, cutoff0, cutoff1, detune=0.4):
    """a brass-like stack: detuned saws through an opening low-pass"""
    n = sec(s); out = np.zeros(n)
    for f in freqs:
        for d in (-detune, 0, detune):
            out += signal.sawtooth(2 * np.pi * f * (1 + d / 100) * t(n) + rng.uniform(0, 6.28))
    out = sweep_lowpass(out, cutoff0, cutoff1) * env_ad(n, attack, s, 2.2)
    rel = sec(release); out[-rel:] *= np.linspace(1, 0, rel); return out / (len(freqs) * 3)
def timpani(f=82, s=1.4):
    return mix(modal([(f, 1, 0.5), (f * 1.5, 0.5, 0.3), (f * 1.98, 0.3, 0.2), (f * 2.44, 0.2, 0.15)], s, 0.002), lowpass(noise(0.05) * env_ad(sec(0.05), 0.0005, 0.05, 5), 500) * 0.8)
def commander(v):
    """the commander arrives: a timpani hit and a short brass swell that opens up, in a hall"""
    swell = brass([130.8, 196, 261.6, 392], 1.3, 0.06, 0.5, 500, 3800)
    top = at(brass([523.2, 659.3], 0.9, 0.04, 0.4, 900, 4500) * 0.5, 0.25)
    x = mix(timpani() * 1.1, swell * 0.9, top, at(grains(0.9, 30, 0.012, 3500, 8000) * env_ad(sec(0.9), 0.1, 0.9, 2) * 0.15, 0.3))
    return finish(reverb(to_stereo(saturate(x, 1.2), 1.0), 2.4, 0.4, 0.025, 0.5), -3)
def attack(v):
    """declaring an attack: a blade drawn — a whoosh crossing the stereo field with a steel ring"""
    whoosh = sweep_bandpass(noise(0.42), 350, 2800, 1.6) * env_ad(sec(0.42), 0.14, 0.42, 3.5)
    tail = sweep_bandpass(noise(0.25), 2800, 700, 1.6) * env_ad(sec(0.25), 0.01, 0.25, 3) * 0.5
    steel = modal([(2600, 1, 0.55), (4150, 0.6, 0.4), (6300, 0.35, 0.3), (1300, 0.3, 0.3)], 0.9, 0.001) * 0.45
    x = move(mix(whoosh, at(tail, 0.3)), -0.6 if v == 0 else 0.6, 0.6 if v == 0 else -0.6)
    x = mix2(x, at(to_stereo(steel), 0.17))
    return finish(reverb(x, 1.3, 0.28, 0.012, 0.6), -5)
def mix2(*layers):
    n = max(len(l) for l in layers); return sum(fit2(to_stereo(l), n) for l in layers)
def block(v):
    """a block: a shield taking the blow — wood body, a little steel, no splash"""
    knock = modal([(180, 1, 0.14), (340, 0.6, 0.09), (520, 0.4, 0.06), (900, 0.2, 0.04)], 0.4, 0.001)
    thud = lowpass(noise(0.05) * env_ad(sec(0.05), 0.0005, 0.05, 5), 700) * 0.9
    steel = modal([(2200, 0.4, 0.18), (3300, 0.25, 0.12)], 0.3, 0.001) * 0.3
    return finish(reverb(to_stereo(mix(knock, thud, steel), 0.5), 0.9, 0.2, 0.01, 0.4), -4)
def hit(v):
    """damage: a heavy impact you feel in the chest — sub drop, body, crack, debris, a room"""
    n = sec(0.45); f = 110 * np.exp(-t(n) / 0.09) + 42
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * env_ad(n, 0.002, 0.45, 3)
    body = lowpass(noise(0.1) * env_ad(sec(0.1), 0.001, 0.1, 4), 420 - v * 60) * 1.1
    crack = highpass(noise(0.014) * env_ad(sec(0.014), 0.0002, 0.014, 6), 2200) * 0.9
    debris = grains(0.35, 26, 0.012, 600, 4000, accel=0.8) * env_ad(sec(0.35), 0.01, 0.35, 2.5) * 0.5
    x = saturate(mix(sub * 1.2, body, crack, at(debris, 0.03)), 1.6)
    return finish(reverb(to_stereo(x, 0.7), 0.9, 0.22, 0.01, 0.35), -1)
def heal(v):
    """life gained: a warm chord that blooms, with a little light on top"""
    n = sec(1.6); chord = np.zeros(n)
    for f, a in [(261.6, 1), (329.6, 0.8), (392, 0.8), (523.2, 0.5), (659.3, 0.3)]:
        chord += a * (np.sin(2 * np.pi * f * t(n)) + 0.4 * np.sin(2 * np.pi * f * 1.003 * t(n)))
    chord = lowpass(chord, 2200) * env_ad(n, 0.18, 1.6, 2.8) / 3.4
    light = at(grains(1.0, 28, 0.015, 3000, 7000) * env_ad(sec(1.0), 0.1, 1.0, 2) * 0.18, 0.15)
    return finish(reverb(to_stereo(mix(chord, light), 1.0), 2.2, 0.45, 0.02, 0.55), -8)
def gong(v):
    """a player eliminated: a large gong — strike, then the bloom of inharmonic partials beating against each other"""
    f0 = 82; parts = []
    for r, a, d in [(1, 1, 3.6), (1.52, 0.7, 3.0), (2.0, 0.6, 2.6), (2.48, 0.5, 2.2), (3.1, 0.4, 1.8), (3.73, 0.3, 1.5), (4.2, 0.25, 1.3), (5.0, 0.18, 1.1), (6.1, 0.12, 0.9), (7.4, 0.08, 0.7)]:
        parts += [(f0 * r, a, d), (f0 * r * 1.004, a * 0.7, d * 0.9)]   # detuned pairs → slow beating
    body = modal(parts, 4.5, 0.004)
    n = len(body); bloom = 0.55 + 0.45 * (1 - np.exp(-t(n) / 0.35)); body = body * bloom
    strike = lowpass(noise(0.06) * env_ad(sec(0.06), 0.001, 0.06, 4), 900) * 0.8
    wash = highpass(noise(1.5), 2500) * env_ad(sec(1.5), 0.25, 1.5, 2.5) * 0.08
    x = saturate(mix(body, strike, wash), 1.3)
    return finish(reverb(to_stereo(x, 1.0), 3.2, 0.45, 0.03, 0.4), -3)
def victory(v):
    """winning: a short brass fanfare phrase over a timpani roll, with a cymbal swell"""
    notes = [([261.6, 329.6, 392], 0.0, 0.22), ([261.6, 329.6, 392], 0.26, 0.22), ([349.2, 440, 523.2], 0.52, 0.3), ([392, 493.9, 587.3, 784], 0.9, 1.3)]
    phrase = mix(*[at(brass(f, d, 0.03, 0.08, 700, 4200), s) for f, s, d in notes])
    roll = mix(*[at(timpani(73, 0.5) * rng.uniform(0.3, 0.6), k * 0.07) for k in range(12)])
    cym = sweep_bandpass(noise(2.2), 5000, 9000, 1.5) * env_ad(sec(2.2), 0.8, 2.2, 1.8) * 0.3
    x = mix(phrase, roll * 0.8, at(timpani(73, 1.6) * 1.2, 0.9), at(cym, 0.4))
    return finish(reverb(to_stereo(saturate(x, 1.2), 1.0), 2.6, 0.45, 0.025, 0.55), -2)
def message(v):
    """chat: a soft wooden note"""
    x = mix(modal([(880, 1, 0.22), (1760, 0.3, 0.1), (3520, 0.15, 0.05)], 0.5, 0.002), lowpass(noise(0.01) * env_ad(sec(0.01), 0.0003, 0.01, 5), 1500) * 0.5)
    return finish(reverb(to_stereo(x), 0.9, 0.2, 0.01, 0.4), -14)
def ui_tick(v):
    """counters and small controls: barely there"""
    x = mix(highpass(noise(0.006) * env_ad(sec(0.006), 0.0002, 0.006, 6), 2500) * 0.7, modal([(2400 + v * 300, 0.5, 0.02)], 0.05, 0.0005))
    return finish(to_stereo(x), -20)
def your_turn(v):
    """it's your turn: a low drum and a rising shimmer — a nudge, not an alarm"""
    drum = mix(modal([(70, 1, 0.5), (105, 0.4, 0.3), (140, 0.2, 0.2)], 1.0, 0.002), lowpass(noise(0.04) * env_ad(sec(0.04), 0.0005, 0.04, 5), 400) * 0.8)
    n = sec(0.9); shimmer = np.zeros(n)
    for k, f in enumerate([523.2, 659.3, 784, 1046.5]): shimmer += fit(at(np.sin(2 * np.pi * f * t(sec(0.7))) * env_ad(sec(0.7), 0.03, 0.7, 3), k * 0.07), n) * 0.25
    return finish(reverb(to_stereo(mix(drum, at(shimmer, 0.1)), 0.8), 1.8, 0.35, 0.02, 0.5), -7)
def pop(v):
    """a token or copy appearing"""
    return token(v)

MANIFEST = {
    # cue: (builder, variants, gain)  — gain is the engine's per-cue multiplier on top of the file's level
    'card_slide': (card_slide, 3, 1.0), 'card_set': (card_set, 2, 1.0), 'card_tap': (card_tap, 3, 1.0), 'shuffle': (shuffle, 2, 1.0),
    'card_flip': (card_flip, 2, 1.0), 'token': (token, 2, 1.0),
    'cast_W': (lambda v: cast('W'), 1, 1.0), 'cast_U': (lambda v: cast('U'), 1, 1.0), 'cast_B': (lambda v: cast('B'), 1, 1.0), 'cast_R': (lambda v: cast('R'), 1, 1.0), 'cast_G': (lambda v: cast('G'), 1, 1.0), 'cast_C': (lambda v: cast('C'), 1, 1.0),
    'counter': (counter_shatter, 1, 1.0), 'commander': (commander, 1, 1.0), 'attack': (attack, 2, 1.0), 'block': (block, 2, 1.0), 'hit': (hit, 2, 1.0),
    'heal': (heal, 1, 1.0), 'eliminated': (gong, 1, 1.0), 'victory': (victory, 1, 1.0), 'message': (message, 1, 1.0), 'ui_tick': (ui_tick, 2, 1.0), 'your_turn': (your_turn, 1, 1.0),
}

def write(name, x):
    os.makedirs(OUT, exist_ok=True); raw = os.path.join(OUT, name + '.wav')
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2'); import wave
    with wave.open(raw, 'wb') as w: w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-c:a', 'libvorbis', '-q:a', '5', os.path.join(OUT, name + '.ogg')], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', raw, '-c:a', 'libmp3lame', '-b:a', '160k', os.path.join(OUT, name + '.mp3')], check=True)
    os.remove(raw); return len(x) / SR

if __name__ == '__main__':
    only = sys.argv[1:]; out = {'format': ['ogg', 'mp3'], 'cues': {}}
    for cue, (fn, nv, gain) in MANIFEST.items():
        if only and cue not in only: continue
        files = []
        for v in range(nv):
            x = fn(v); name = f'{cue}{v + 1 if nv > 1 else ""}'; d = write(name, x); files.append(name)
            print(f'{name:14s} {d:5.2f}s  peak {20 * np.log10(np.abs(x).max() + 1e-9):6.1f} dB  rms {20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9):6.1f} dB')
        out['cues'][cue] = {'files': files, 'gain': gain}
    if not only:
        with open(os.path.join(OUT, 'manifest.json'), 'w') as f: json.dump(out, f, indent=1)
