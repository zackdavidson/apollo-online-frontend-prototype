#!/usr/bin/env python3
"""Render the talent icons for the side panel's Talents tab (pure Python, no dependencies).

Each icon is a 16x16 pixel-art glyph scaled up 4x with hard pixels, in the
spirit of an old-school skills tab. Run: python3 tools/generate-talent-icons.py
Writes public/assets/talents/<talent id>.png; src/game/talents.ts lists them.
"""
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'talents')
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


# One shared palette so the set reads as a family; '.' is transparent.
PALETTE = {
    '.': (0, 0, 0, 0),
    'k': hex_rgba('#141620'),   # outline
    'w': hex_rgba('#f4f6fa'),   # white
    'c': hex_rgba('#6fd3ff'),   # cyan
    'C': hex_rgba('#2f7fb3'),   # cyan shade
    'b': hex_rgba('#3f57a3'),   # blue
    'B': hex_rgba('#7c9cff'),   # blue light
    'g': hex_rgba('#d9b45a'),   # brass
    'G': hex_rgba('#8f6f2a'),   # brass shade
    'y': hex_rgba('#fff0a8'),   # brass highlight
    'r': hex_rgba('#e0483c'),   # red
    'R': hex_rgba('#8c2a24'),   # red shade
    'o': hex_rgba('#ff8a2a'),   # orange
    'O': hex_rgba('#b8501a'),   # orange shade
    'f': hex_rgba('#ffd24a'),   # flame
    's': hex_rgba('#a3aab4'),   # steel
    'S': hex_rgba('#5c6470'),   # steel shade
    'n': hex_rgba('#7a5230'),   # wood
    'N': hex_rgba('#4a2f1c'),   # wood shade
    'e': hex_rgba('#7ddc6a'),   # green
    'E': hex_rgba('#2f7a3a'),   # green shade
    'p': hex_rgba('#b45cff'),   # purple
    'P': hex_rgba('#5d2a8c'),   # purple shade
}

ICONS = {
    # A small delta ship seen from above, nose up.
    'piloting': [
        '................',
        '.......kk.......',
        '......kwwk......',
        '......kwwk......',
        '.....kwccwk.....',
        '.....kwccwk.....',
        '....kwwccwwk....',
        '....kwwccwwk....',
        '...kwwwccwwwk...',
        '...kwwwCCwwwk...',
        '..kwwwkCCkwwwk..',
        '..kwwkkCCkkwwk..',
        '.kwwk.kCCk.kwwk.',
        '.kkkk.kook.kkkk.',
        '......kffk......',
        '.......kk.......',
    ],
    # A crosshair.
    'gunnery': [
        '.......kk.......',
        '......kwwk......',
        '......kwwk......',
        '....kkkwwkkk....',
        '...kwwwkkwwwk...',
        '..kwwk....kwwk..',
        '.kwwk..rr..kwwk.',
        'kwwwk.rrrr.kwwwk',
        'kwwwk.rrrr.kwwwk',
        '.kwwk..rr..kwwk.',
        '..kwwk....kwwk..',
        '...kwwwkkwwwk...',
        '....kkkwwkkk....',
        '......kwwk......',
        '......kwwk......',
        '.......kk.......',
    ],
    # A wrench, diagonal.
    'engineering': [
        '..........kkkk..',
        '.........kssssk.',
        '........kss..ssk',
        '........ks....sk',
        '........kss..kk.',
        '.......kssssk...',
        '......kssssk....',
        '.....kssssk.....',
        '....kssssk......',
        '...kssssk.......',
        '..kssssk........',
        '.kssssk.........',
        'kSsssk..........',
        'kSSsk...........',
        'kSSk............',
        '.kk.............',
    ],
    # A pickaxe: steel head, wooden handle.
    'mining': [
        '......kkkkk.....',
        '....kkssssskk...',
        '...ksss...ssssk.',
        '..kss.......sssk',
        '..ks.........ksk',
        '..kk..knnk....k.',
        '......knnk......',
        '.....knnnk......',
        '.....knnk.......',
        '....knnnk.......',
        '....knnk........',
        '...knnnk........',
        '...knnk.........',
        '..kNnnk.........',
        '..kNNk..........',
        '...kk...........',
    ],
    # A furnace: dark body, flame in the mouth.
    'refining': [
        '....kkkkkkkk....',
        '...kSSSSSSSSk...',
        '..kSssssssssSk..',
        '..kSsssssssSSk..',
        '..kSsskkkkssSk..',
        '..kSskffffkSSk..',
        '..kSskfoofkssk..',
        '..kSskoOOokSSk..',
        '..kSskkOOkkssk..',
        '..kSsssssssSSk..',
        '..kSSSSSSSSSSk..',
        '.kSSSSSSSSSSSSk.',
        '.kkkkkkkkkkkkkk.',
        '..kSSk....kSSk..',
        '..kkkk....kkkk..',
        '................',
    ],
    # A skull: slayer contracts on marked prey.
    'slayer': [
        '................',
        '.....kkkkkk.....',
        '....kwwwwwwk....',
        '...kwwwwwwwwk...',
        '..kwwwwwwwwwwk..',
        '..kwwkkwwkkwwk..',
        '..kwkrrkkrrkwk..',
        '..kwkrrkkrrkwk..',
        '..kwwkkwwkkwwk..',
        '..kwwwwkkwwwwk..',
        '...kwwwwwwwwk...',
        '...kkwwwwwwkk...',
        '....kwkwwkwk....',
        '....kwkwwkwk....',
        '....kkkkkkkk....',
        '................',
    ],
    # A plant in a pot: xenobiology.
    'xenobiology': [
        '................',
        '.......kk.......',
        '......keek......',
        '.....keeeek.....',
        '.....keEeek.....',
        '......kEek......',
        '..kk...kk...kk..',
        '.keek..kk..keek.',
        'keeeek.kk.keeeek',
        'kEeeeekkkkeeeeEk',
        '.kEEeekkkkeeEEk.',
        '..kkkkkEEkkkkk..',
        '......kEEk......',
        '....kkkEEkkk....',
        '...knnnnnnnnk...',
        '....kkkkkkkk....',
    ],
    # A gas canister with wisps escaping: the raw gas leaks until it is refined.
    'gas-harvesting': [
        '......pp........',
        '.....p..p.......',
        '......pp.p......',
        '....kkkkkkkk....',
        '...kssssssssk...',
        '...kssSSSSssk...',
        '...kssssssssk...',
        '...ksspppsssk...',
        '...kspppppssk...',
        '...kspPPppssk...',
        '...ksspppsssk...',
        '...kssssssssk...',
        '...kSssssssSk...',
        '...kSSSSSSSSk...',
        '....kkkkkkkk....',
        '................',
    ],
    # A ring snare with bait in the middle and a stake: hunting.
    'hunting': [
        '....kkkkkkkk....',
        '..kksssssssskk..',
        '.kssk.kk..kk.ssk',
        '.ksk.........ksk',
        'kssk...kk...kssk',
        'ksk....oo....ksk',
        'ksk...oooo...ksk',
        'ksk...oooo...ksk',
        'ksk....oo....ksk',
        'kssk...kk...kssk',
        '.ksk.........ksk',
        '.kssk.kk..kk.ssk',
        '..kksssssssskk..',
        '....kkkkkkkk....',
        '......kSSk......',
        '......kkkk......',
    ],
    # A flask of green reagent: chemistry.
    'chemistry': [
        '......kkkk......',
        '......kwwk......',
        '......kwwk......',
        '......kwwk......',
        '.....kwwwwk.....',
        '.....kwwwwk.....',
        '....kwwwwwwk....',
        '....kweeeewk....',
        '...kweeeeeewk...',
        '...keeeeeeeek...',
        '..keeeEeeeeeek..',
        '..keeeeeeEeeek..',
        '..kEeeeeeeeeEk..',
        '..kEEEEEEEEEEk..',
        '...kkkkkkkkkk...',
        '................',
    ],
    # A strapped cargo crate: salvaging.
    'salvaging': [
        '................',
        '.kkkkkkkkkkkkkk.',
        'knnnnnnggnnnnnnk',
        'knnnnnnggnnnnnnk',
        'knnnnnnggnnnnnnk',
        'kggggggggggggggk',
        'kggggggggggggggk',
        'knnnnnnggnnnnnnk',
        'kNnnnnnggnnnnnNk',
        'kNnnnnnggnnnnnNk',
        'kNNnnnnggnnnnNNk',
        'kNNNnnnggnnnNNNk',
        'kNNNNNNGGNNNNNNk',
        'kNNNNNNGGNNNNNNk',
        '.kkkkkkkkkkkkkk.',
        '................',
    ],
}


def render(rows, palette, scale):
    size = len(rows)
    assert all(len(row) == size for row in rows), 'icon rows must be square'
    width = height = size * scale
    rgba = bytearray(width * height * 4)
    for y, row in enumerate(rows):
        for x, char in enumerate(row):
            colour = palette[char]
            for dy in range(scale):
                for dx in range(scale):
                    i = ((y * scale + dy) * width + (x * scale + dx)) * 4
                    rgba[i:i + 4] = bytes(colour)
    return width, height, rgba


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, rows in ICONS.items():
        width, height, rgba = render(rows, PALETTE, SCALE)
        write_png(os.path.join(OUT, f'{name}.png'), width, height, rgba)
        print(f'{name}.png')
    print(f'done -> {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()
