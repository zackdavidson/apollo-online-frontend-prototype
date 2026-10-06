#!/usr/bin/env python3
"""Generate the tileable hull material textures as PNG files.

    python3 tools/generate-materials.py

Writes public/assets/materials/*.png: seamless 256x256 tiles that
src/core/materials.ts maps onto hulls (README, "Hull materials").

Each material is a colour tile plus, where it glows, a greyscale mask:

    stone.png                   flagstones, neutral grey
    obsidian.png / -glow.png    dark glass with purple veins; the veins glow
    lava.png / -glow.png        cooling crust; the cracks and pools glow

The colour tile is blended over the hull's own colour as an overlay, so mid
grey leaves the paint untouched, lighter texels brighten it and darker ones
shade it; coloured texels tint it. Pure Python, no dependencies. Replace any
file with your own art of the same name; it only has to tile.
"""
import math
import os
import random
import struct
import time
import zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'materials')
SIZE = 256


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
    """Value noise on a grid of `cells` that wraps, so fbm(u * cells, v * cells) tiles over the unit square."""

    def __init__(self, rng, cells):
        self.cells = cells
        self.grid = [[rng.random() for _ in range(cells)] for _ in range(cells)]

    def value(self, x, y):
        xi = math.floor(x)
        yi = math.floor(y)
        fx = x - xi
        fy = y - yi
        fx = fx * fx * (3 - 2 * fx)
        fy = fy * fy * (3 - 2 * fy)
        n = self.cells
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

    def fbm(self, u, v, octaves=4, gain=0.5):
        """Fractal sum over the unit square; every octave doubles the frequency so all of them tile."""
        amplitude = 1.0
        frequency = float(self.cells)
        total = 0.0
        norm = 0.0
        for _ in range(octaves):
            total += amplitude * self.value(u * frequency, v * frequency)
            norm += amplitude
            amplitude *= gain
            frequency *= 2.0
        return total / norm


class Cells:
    """Worley cells on a torus: distances wrap, so the cell pattern tiles."""

    def __init__(self, rng, count):
        self.points = [(rng.random(), rng.random(), rng.random()) for _ in range(count)]

    def nearest(self, u, v):
        """(distance to the nearest point, to the second nearest, the nearest point's random shade)."""
        first = 9.0
        second = 9.0
        shade = 0.0
        for px, py, s in self.points:
            dx = px - u
            dx -= round(dx)
            dy = py - v
            dy -= round(dy)
            d = math.sqrt(dx * dx + dy * dy)
            if d < first:
                second = first
                first = d
                shade = s
            elif d < second:
                second = d
        return first, second, shade


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def smoothstep(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def ridged(noise, u, v, sharpness, octaves=5):
    """Thin bright lines where fbm crosses its midpoint, 1 on the line falling to 0 `1/sharpness` away."""
    return clamp01(1 - abs(noise.fbm(u, v, octaves) - 0.5) * sharpness)


def put(img, size, px, py, col, alpha=1.0):
    i = (py * size + px) * 4
    img[i] = int(clamp01(col[0]) * 255)
    img[i + 1] = int(clamp01(col[1]) * 255)
    img[i + 2] = int(clamp01(col[2]) * 255)
    img[i + 3] = int(clamp01(alpha) * 255)


def render(size, shade):
    """Run `shade(u, v) -> (colour, glow)` over the tile; returns (colour rgba, glow rgba)."""
    colour = bytearray(size * size * 4)
    glow = bytearray(size * size * 4)
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            col, g = shade(u, v)
            put(colour, size, x, y, col)
            put(glow, size, x, y, (g, g, g))
    return colour, glow


# ---- materials -------------------------------------------------------------

def stone(size, seed=7):
    """Fitted flagstones: neutral grey slabs around mid grey, dark mortar, a little grain and pitting."""
    rng = random.Random(seed)
    warp = Noise(rng, 6)
    grain = Noise(rng, 24)
    pits = Noise(rng, 48)
    cells = Cells(rng, 18)

    def shade(u, v):
        wu = u + (warp.fbm(u, v, 3) - 0.5) * 0.05
        wv = v + (warp.fbm(u + 0.37, v + 0.71, 3) - 0.5) * 0.05
        f1, f2, cell = cells.nearest(wu, wv)
        edge = f2 - f1
        mortar = smoothstep(0.0, 0.028, edge)
        bevel = smoothstep(0.028, 0.10, edge)
        g = grain.fbm(u, v, 3) - 0.5
        value = 0.42 + cell * 0.16 + g * 0.12 + bevel * 0.05
        pit = smoothstep(0.80, 0.90, pits.fbm(u, v, 2))
        value -= pit * 0.14
        value = 0.26 + (value - 0.26) * mortar
        tint = (cell - 0.5) * 0.04
        return (value + tint, value, value - tint), 0.0

    return shade


def obsidian(size, seed=11):
    """Volcanic glass: dark facets with a purple cast, glinting edges and thin glowing veins."""
    rng = random.Random(seed)
    warp = Noise(rng, 5)
    grain = Noise(rng, 20)
    veins = Noise(rng, 4)
    cells = Cells(rng, 11)

    def shade(u, v):
        wu = u + (warp.fbm(u, v, 3) - 0.5) * 0.06
        wv = v + (warp.fbm(u + 0.53, v + 0.19, 3) - 0.5) * 0.06
        f1, f2, cell = cells.nearest(wu, wv)
        edge = f2 - f1
        facet = 0.07 + cell * 0.10 + (grain.fbm(u, v, 2) - 0.5) * 0.04
        col = (facet * 1.1 + 0.02, facet * 0.85, facet * 1.35 + 0.05)
        glint = 1 - smoothstep(0.0, 0.012, edge)
        col = mix(col, (0.40, 0.30, 0.55), glint * 0.7)
        ridge = ridged(veins, wu, wv, 7.0)
        vein = smoothstep(0.80, 0.93, ridge)
        core = smoothstep(0.93, 0.99, ridge)
        haze = smoothstep(0.45, 0.80, ridge) * (1 - vein)
        col = mix(col, (0.22, 0.09, 0.34), haze * 0.5)
        vein_col = mix((0.48, 0.18, 0.78), (0.90, 0.66, 1.0), core)
        col = mix(col, vein_col, vein)
        return col, vein * (0.5 + 0.5 * core) + haze * 0.08

    return shade


def lava(size, seed=13):
    """Cooling crust over molten rock: dark cinder, glowing cracks with a warm halo, and a few open pools."""
    rng = random.Random(seed)
    warp = Noise(rng, 3)
    crust = Noise(rng, 10)
    cracks = Noise(rng, 4)
    pools = Noise(rng, 2)

    def shade(u, v):
        wu = u + (warp.fbm(u, v, 3) - 0.5) * 0.14
        wv = v + (warp.fbm(u + 0.61, v + 0.29, 3) - 0.5) * 0.14
        ridge = ridged(cracks, wu, wv, 5.0)
        crack = smoothstep(0.78, 0.92, ridge)
        core = smoothstep(0.93, 0.99, ridge)
        halo = smoothstep(0.40, 0.82, ridge)
        pool = smoothstep(0.66, 0.72, pools.fbm(u, v, 3))
        heat = max(crack, pool)
        g = crust.fbm(u, v, 3)
        cinder = 0.08 + g * 0.13
        col = (cinder * 1.2, cinder * 0.95, cinder * 0.85)
        col = mix(col, (0.42, 0.09, 0.02), halo * 0.5 * (1 - heat))
        lava_col = mix((0.78, 0.12, 0.0), (1.0, 0.52, 0.06), heat)
        lava_col = mix(lava_col, (1.0, 0.92, 0.5), core)
        col = mix(col, lava_col, heat)
        return col, heat * (0.6 + 0.4 * core) + halo * 0.10 * (1 - heat)

    return shade


MATERIALS = [
    ('stone', stone, False),
    ('obsidian', obsidian, True),
    ('lava', lava, True),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    started = time.time()
    for name, factory, glows in MATERIALS:
        t0 = time.time()
        colour, glow = render(SIZE, factory(SIZE))
        write_png(os.path.join(OUT, f'{name}.png'), SIZE, SIZE, colour)
        if glows:
            write_png(os.path.join(OUT, f'{name}-glow.png'), SIZE, SIZE, glow)
        print(f"{name}.png{' + glow' if glows else ''}  {time.time() - t0:.1f}s")
    print(f"done in {time.time() - started:.1f}s -> {os.path.relpath(OUT)}")


if __name__ == '__main__':
    main()
