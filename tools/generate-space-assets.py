#!/usr/bin/env python3
"""Generate the 2D background art for flight mode as PNG files.

    python3 tools/generate-space-assets.py

Writes public/assets/space/*.png. Pure Python (no Pillow/numpy needed).
Replace any file with your own art of the same name; src/flight/spaceAssets.ts
describes how each file is used (planet discs are centred, see discFraction).
"""
import math
import os
import random
import struct
import time
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'space')


def write_png(path, width, height, rgba):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw += b'\x00' + rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as handle:
        handle.write(png)


class Noise:
    """Tileable value noise with fBm."""

    def __init__(self, rng, size=64):
        self.size = size
        self.grid = [[rng.random() for _ in range(size)] for _ in range(size)]

    def value(self, x, y):
        xi = math.floor(x)
        yi = math.floor(y)
        fx = x - xi
        fy = y - yi
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        n = self.size
        x0 = xi % n
        x1 = (xi + 1) % n
        y0 = yi % n
        y1 = (yi + 1) % n
        g = self.grid
        a = g[y0][x0]
        b = g[y0][x1]
        c = g[y1][x0]
        d = g[y1][x1]
        return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

    def fbm(self, x, y, octaves=4, gain=0.5):
        amplitude = 1.0
        frequency = 1.0
        total = 0.0
        norm = 0.0
        for _ in range(octaves):
            total += amplitude * self.value(x * frequency, y * frequency)
            norm += amplitude
            amplitude *= gain
            frequency *= 2.0
        return total / norm


def hex_rgb(value):
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def smoothstep(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def put(img, size, px, py, col, alpha):
    i = (py * size + px) * 4
    img[i] = int(clamp01(col[0]) * 255)
    img[i + 1] = int(clamp01(col[1]) * 255)
    img[i + 2] = int(clamp01(col[2]) * 255)
    img[i + 3] = int(clamp01(alpha) * 255)


LIGHT = (-0.5, -0.6, 0.62)
_l = math.sqrt(sum(c * c for c in LIGHT))
LIGHT = tuple(c / _l for c in LIGHT)


# ---- surface shaders -------------------------------------------------------

def gas_surface(palette, bands=7.0, storms=1):
    """Smooth latitude bands through a multi-stop palette with gentle turbulence."""
    def shade(noise, lon, lat, seed):
        turbulence = (noise.fbm(lon * 1.1 + seed, lat * 3.0 + seed, 4) - 0.5) * 2.2
        drift = (noise.fbm(lon * 0.5 + 7 + seed, lat * 1.5, 3) - 0.5) * 0.8
        t = 0.5 + 0.5 * math.sin(lat * bands + turbulence + drift)
        colour = palette_at(palette, t)
        # One or two soft oval storms.
        for k in range(storms):
            slon = -0.9 + k * 2.1 + seed * 0.3
            slat = 0.25 - k * 0.5
            d = math.hypot((lon - slon) * 0.55, (lat - slat) * 1.4)
            if d < 0.22:
                colour = mix(colour, palette_at(palette, 1.0 - t), smoothstep(0.22, 0.08, d) * 0.6)
        return colour
    return shade


def palette_at(palette, t):
    t = clamp01(t) * (len(palette) - 1)
    i = min(int(t), len(palette) - 2)
    return mix(palette[i], palette[i + 1], t - i)


def rocky_surface(c1, c2, craters, crater_count=18):
    def shade(noise, lon, lat, seed):
        n = noise.fbm(lon * 2.4 + seed, lat * 2.4 + seed * 2, 5)
        colour = mix(c1, c2, smoothstep(0.32, 0.68, n))
        # Craters: angular distance on the sphere.
        x = math.cos(lat) * math.sin(lon)
        y = math.sin(lat)
        z = math.cos(lat) * math.cos(lon)
        for (clon, clat, radius, depth) in craters:
            cx = math.cos(clat) * math.sin(clon)
            cy = math.sin(clat)
            cz = math.cos(clat) * math.cos(clon)
            d = math.acos(max(-1.0, min(1.0, x * cx + y * cy + z * cz)))
            if d < radius:
                rim = smoothstep(radius * 0.6, radius, d)
                colour = tuple(c * (1 - depth * (1 - rim)) * (1 + 0.35 * depth * rim) for c in colour)
        return colour
    return shade


def ice_surface(c1, c2, c3):
    def shade(noise, lon, lat, seed):
        n = noise.fbm(lon * 3.0 + seed, lat * 6.0, 4)
        colour = mix(c1, c2, 0.5 + 0.5 * math.sin(lat * 5 + n * 2))
        crack = noise.fbm(lon * 7 + seed * 3, lat * 7 + 2, 4)
        if abs(crack - 0.5) < 0.025:
            colour = mix(colour, c3, 1 - abs(crack - 0.5) / 0.025)
        return colour
    return shade


def lava_surface(c1, c2, c3):
    def shade(noise, lon, lat, seed):
        n = noise.fbm(lon * 4.0 + seed, lat * 4.0 + seed, 5)
        colour = mix(c1, c2, smoothstep(0.3, 0.6, n))
        glow = noise.fbm(lon * 9 + 4, lat * 9 + seed, 4)
        if abs(glow - 0.5) < 0.04:
            colour = mix(colour, c3, (1 - abs(glow - 0.5) / 0.04) ** 1.5)
        return colour
    return shade


# ---- renderers --------------------------------------------------------------

def render_planet(spec, size):
    rng = random.Random(spec['seed'])
    noise = Noise(rng)
    seed = rng.random() * 10
    cx = cy = size / 2.0
    disc = spec.get('disc', 0.42)
    R = size * disc
    img = bytearray(size * size * 4)
    atmosphere = spec.get('atmosphere')
    haze = spec.get('haze', 0.12)
    surface = spec['surface']
    emissive = spec.get('emissive')

    for py in range(size):
        for px in range(size):
            ox = px + 0.5 - cx
            oy = py + 0.5 - cy
            rpx = math.hypot(ox, oy)
            dx = ox / R
            dy = oy / R
            r2 = dx * dx + dy * dy
            col = (0.0, 0.0, 0.0)
            alpha = 0.0
            # Coverage of the disc edge over ~1.5 px for a clean anti-aliased rim.
            coverage = clamp01((R - rpx) / 1.5 + 0.5)
            if coverage > 0:
                rr = min(r2, 0.999999)
                nz = math.sqrt(1.0 - rr)
                lon = math.atan2(dx, nz)
                lat = math.asin(max(-1.0, min(1.0, dy)))
                base = surface(noise, lon, lat, seed)
                diffuse = max(0.0, dx * LIGHT[0] + dy * LIGHT[1] + nz * LIGHT[2])
                shade = 0.06 + 0.94 * diffuse ** 0.8
                col = tuple(c * shade for c in base)
                # A touch of specular on smooth worlds.
                hx, hy, hz = LIGHT[0], LIGHT[1], LIGHT[2] + 1.0
                hl = math.sqrt(hx * hx + hy * hy + hz * hz)
                spec_term = max(0.0, (dx * hx + dy * hy + nz * hz) / hl) ** 40 * spec.get('gloss', 0.15)
                col = tuple(c + spec_term for c in col)
                if emissive:
                    glow = emissive(noise, lon, lat, seed)
                    col = tuple(col[i] + glow[i] for i in range(3))
                if atmosphere:
                    fresnel = (1.0 - nz) ** 2.6
                    col = mix(col, atmosphere, fresnel * 0.55 * (0.2 + 0.8 * diffuse))
                alpha = coverage
            if atmosphere and coverage < 1:
                r = math.sqrt(r2)
                if r < 1.0 + haze:
                    t = clamp01(1.0 - (r - 1.0) / haze)
                    light_side = 0.5 + 0.5 * (-(dx) * 0.6 - dy * 0.7)
                    a = t * t * 0.5 * (0.3 + 0.7 * light_side) * (1 - coverage)
                    col = tuple(col[i] * alpha + atmosphere[i] * a for i in range(3))
                    alpha = alpha + a * (1 - alpha)
                    if alpha > 0:
                        col = tuple(c / alpha for c in col)
            if alpha > 0:
                put(img, size, px, py, col, alpha)
    return img


def render_star_sprite(size=64):
    img = bytearray(size * size * 4)
    c = size / 2.0
    for py in range(size):
        for px in range(size):
            dx = (px + 0.5 - c) / c
            dy = (py + 0.5 - c) / c
            r = math.sqrt(dx * dx + dy * dy)
            if r >= 1:
                continue
            core = (1 - r) ** 3.0
            glare = max(0.0, 1 - abs(dx) * 7) * (1 - r) * 0.35 + max(0.0, 1 - abs(dy) * 7) * (1 - r) * 0.35
            a = clamp01(core + glare)
            put(img, size, px, py, (1.0, 1.0, 1.0), a)
    return img


def render_sun(size=256):
    img = bytearray(size * size * 4)
    c = size / 2.0
    for py in range(size):
        for px in range(size):
            dx = (px + 0.5 - c) / c
            dy = (py + 0.5 - c) / c
            r = math.sqrt(dx * dx + dy * dy)
            if r >= 1:
                continue
            core = smoothstep(0.16, 0.03, r)
            corona = (1 - r) ** 3.0 * 0.7
            a = clamp01(core + corona)
            colour = mix((1.0, 0.78, 0.5), (1.0, 1.0, 0.96), core)
            put(img, size, px, py, colour, a)
    return img


def render_nebula(seed, size=384):
    rng = random.Random(seed)
    noise = Noise(rng, 48)
    img = bytearray(size * size * 4)
    c = size / 2.0
    ox = rng.random() * 50
    oy = rng.random() * 50
    for py in range(size):
        for px in range(size):
            x = px / size
            y = py / size
            dx = (px + 0.5 - c) / c
            dy = (py + 0.5 - c) / c
            r = math.sqrt(dx * dx + dy * dy)
            if r >= 1:
                continue
            n = noise.fbm(x * 3.5 + ox, y * 3.5 + oy, 5)
            m = noise.fbm(x * 8.0 + oy, y * 8.0 + ox, 4)
            body = smoothstep(0.42, 0.74, n)
            wisps = smoothstep(0.5, 0.8, m) * 0.5
            falloff = (1 - r) ** 1.6
            a = clamp01((body * 0.85 + wisps) * falloff)
            put(img, size, px, py, (1.0, 0.88 + 0.12 * m, 0.82 + 0.18 * n), a)
    return img


PLANETS = [
    dict(name='planet-gas-01', seed=11, size=1024, atmosphere=hex_rgb('#a9c6ff'), gloss=0.1,
         surface=gas_surface([hex_rgb('#4f6fb0'), hex_rgb('#7f9fd6'), hex_rgb('#d7e2f3'), hex_rgb('#8ea8d8'), hex_rgb('#5b78b8')], bands=9.0, storms=1)),
    dict(name='planet-gas-02', seed=23, size=1024, atmosphere=hex_rgb('#ffd9a0'), gloss=0.1,
         surface=gas_surface([hex_rgb('#b56a3c'), hex_rgb('#e0a870'), hex_rgb('#f4dfb8'), hex_rgb('#c98853'), hex_rgb('#8a4a2a')], bands=12.0, storms=2)),
    dict(name='planet-rock-01', seed=37, size=1024, atmosphere=hex_rgb('#8fb8ff'), haze=0.09, gloss=0.35,
         surface=rocky_surface(hex_rgb('#2f5f93'), hex_rgb('#7fa366'), [(0.4, 0.3, 0.16, 0.3), (-1.2, -0.5, 0.2, 0.35), (2.0, 0.9, 0.12, 0.3)])),
    dict(name='planet-rock-02', seed=41, size=1024, atmosphere=hex_rgb('#e8c9a0'), haze=0.06,
         surface=rocky_surface(hex_rgb('#8a6a4a'), hex_rgb('#d8bc92'), [(0.2, 0.1, 0.3, 0.45), (-1.0, 0.7, 0.18, 0.4), (1.6, -0.6, 0.24, 0.45), (-2.0, -0.3, 0.14, 0.35), (2.6, 0.5, 0.2, 0.4)])),
    dict(name='planet-ice-01', seed=53, size=1024, atmosphere=hex_rgb('#d6ecff'), haze=0.1, gloss=0.4,
         surface=ice_surface(hex_rgb('#e4f1f8'), hex_rgb('#a9d2ea'), hex_rgb('#4a86b8'))),
    dict(name='planet-lava-01', seed=67, size=1024, atmosphere=hex_rgb('#ff9a5a'), haze=0.08,
         surface=lava_surface(hex_rgb('#241c1c'), hex_rgb('#43352f'), hex_rgb('#ff7a2a')),
         emissive=lambda noise, lon, lat, seed: tuple(c * (0.9 if abs(noise.fbm(lon * 9 + 4, lat * 9 + seed, 4) - 0.5) < 0.04 else 0.0) for c in hex_rgb('#ff6a1a'))),
    dict(name='moon-01', seed=71, size=512, disc=0.44,
         surface=rocky_surface(hex_rgb('#8c8c8c'), hex_rgb('#c8c8c8'), [(0.3, 0.2, 0.3, 0.5), (-1.1, -0.6, 0.25, 0.5), (1.9, 0.8, 0.2, 0.4), (-2.3, 0.3, 0.35, 0.5), (0.9, -1.0, 0.18, 0.45)])),
    dict(name='moon-02', seed=79, size=512, disc=0.44,
         surface=rocky_surface(hex_rgb('#b8a26a'), hex_rgb('#e0d4b0'), [(0.5, 0.4, 0.28, 0.45), (-1.4, 0.2, 0.22, 0.5), (2.2, -0.5, 0.3, 0.5)])),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    started = time.time()
    for spec in PLANETS:
        t0 = time.time()
        write_png(os.path.join(OUT, spec['name'] + '.png'), spec['size'], spec['size'], render_planet(spec, spec['size']))
        print(f"{spec['name']}.png  {time.time() - t0:.1f}s")
    for index, seed in enumerate([101, 113, 127], start=1):
        t0 = time.time()
        write_png(os.path.join(OUT, f'nebula-{index:02d}.png'), 384, 384, render_nebula(seed))
        print(f"nebula-{index:02d}.png  {time.time() - t0:.1f}s")
    write_png(os.path.join(OUT, 'star.png'), 64, 64, render_star_sprite())
    write_png(os.path.join(OUT, 'sun.png'), 256, 256, render_sun())
    print(f"done in {time.time() - started:.1f}s -> {os.path.relpath(OUT)}")


if __name__ == '__main__':
    main()
