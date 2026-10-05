#!/usr/bin/env python3
"""Render the NPC portrait PNGs used by the dialogue box (pure Python, no dependencies).

Each portrait is a 32x32 pixel-art bust scaled up 4x with hard pixels, so it
reads like an old-school game head. Run: python3 tools/generate-portraits.py
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'portraits')
SCALE = 4


def write_png(path, width, height, rgba):
    raw = b''.join(b'\x00' + bytes(rgba[y * width * 4:(y + 1) * width * 4]) for y in range(height))

    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as handle:
        handle.write(png)


def hex_rgba(value, alpha=255):
    value = value.lstrip('#')
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


NAVIGATOR_PALETTE = {
    '.': (0, 0, 0, 0),
    'k': hex_rgba('#1b1a24'),
    'h': hex_rgba('#2d3f7a'),
    'H': hex_rgba('#3f57a3'),
    'g': hex_rgba('#e2b84a'),
    'G': hex_rgba('#a9822a'),
    's': hex_rgba('#e3b08a'),
    'S': hex_rgba('#c58e68'),
    'L': hex_rgba('#f0c7a4'),
    'e': hex_rgba('#f4f4f4'),
    'p': hex_rgba('#1d2a3f'),
    'b': hex_rgba('#4a2f22'),
    'm': hex_rgba('#8a4a44'),
    'u': hex_rgba('#2c4a3c'),
    'U': hex_rgba('#3c6650'),
    'c': hex_rgba('#e8e0c9'),
    'v': hex_rgba('#6fd3ff'),
}

# A navigator in a navy cap with a gold band and star, cream collar, green guild uniform.
NAVIGATOR = [
    '................................',
    '............kkkkkkkk............',
    '..........kkhhhhhhhhkk..........',
    '.........khhHHHHHHHHhhk.........',
    '........khhHHHHHHHHHHhhk........',
    '........khhhhhhhhhhhhhhk........',
    '........khhhhhggGghhhhhk........',
    '.......kkhhhhhgGGGghhhhkk.......',
    '......kGGGGGGGGGGGGGGGGGGk......',
    '.......kkkkkkkkkkkkkkkkkk.......',
    '........kssLLLLLLLLLLssk........',
    '.......ksssLLLLLLLLLLsssk.......',
    '.......kssbbbssssssbbbssk.......',
    '.......kssepsssssssspessk.......',
    '.......ksssssssSSsssssssk.......',
    '.......kSssssssSSssssssSk.......',
    '.......kSsssssssssssssssk.......',
    '........kSsssmmmmmmsssSk........',
    '........kSSsssssssssSSk.........',
    '.........kSSSsssssSSSk..........',
    '..........kkSSSSSSkk............',
    '......kkkkkkkSSSSkkkkkkk........',
    '.....kccuuuukSSSSkuuuucck.......',
    '....kccuuuuuukSSkuuuuuucck......',
    '....kcuuUUuuuukkuuuuUUuuck......',
    '...kcuuuUUuuuuuuuuuuUUuuuck.....',
    '...kcuuuuuuuuggguuuuuuuuuck.....',
    '...kuuuuuuuuugGguuuuuuuuuuk.....',
    '...kuuuuuuuuuggguuuuuuuuuuk.....',
    '...kuuuuuuuuuuuuuuuuuuuuuuk.....',
    '...kkkkkkkkkkkkkkkkkkkkkkkk.....',
    '................................',
]


def render(rows, palette, scale):
    size = len(rows)
    for row in rows:
        if len(row) != size:
            raise SystemExit(f'row length {len(row)} != {size}: {row!r}')
    width = height = size * scale
    out = bytearray(width * height * 4)
    for y, row in enumerate(rows):
        for x, char in enumerate(row):
            colour = palette[char]
            for dy in range(scale):
                for dx in range(scale):
                    i = ((y * scale + dy) * width + (x * scale + dx)) * 4
                    out[i:i + 4] = bytes(colour)
    return width, height, out


def main():
    os.makedirs(OUT, exist_ok=True)
    width, height, pixels = render(NAVIGATOR, NAVIGATOR_PALETTE, SCALE)
    path = os.path.join(OUT, 'navigator.png')
    write_png(path, width, height, pixels)
    print(f'wrote {path} ({width}x{height})')


if __name__ == '__main__':
    main()
