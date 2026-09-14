#!/usr/bin/env python3
"""Generate Drill Pick's app icons.

A brilliant-cut drill on a canvas-grid ground, rasterised with 3x supersampling
and written as PNG through zlib alone, so the repo needs no imaging dependency.
Run from the drill-pick folder:  python3 tools/make-icons.py
"""
import math
import os
import struct
import zlib

SIZES = (180, 192, 512)
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
SS = 3  # supersampling factor

GROUND_IN = (42, 33, 64)     # #2A2140
GROUND_OUT = (16, 12, 28)    # #100C1C
GRID_DOT = (64, 52, 92)
GLOW = (123, 75, 196)        # amethyst, matching LEGEND[0]

SCALE = 0.85  # keeps the gem inside a maskable safe zone

# Brilliant cut: table, two crown facets, two pavilion facets.
P0, P1 = (-0.26, -0.32), (0.26, -0.32)   # table edge
P2, P4 = (0.46, -0.10), (-0.46, -0.10)   # girdle
P3 = (0.0, 0.46)                          # culet
C = (0.0, -0.10)                          # centre of the girdle line

FACETS = [
    ((P0, P1, C), (243, 233, 255)),   # table, catching the light
    ((P0, P4, C), (201, 168, 240)),   # left crown
    ((P1, P2, C), (154, 111, 216)),   # right crown
    ((P4, P3, C), (123, 75, 196)),    # left pavilion
    ((P2, P3, C), (90, 52, 150)),     # right pavilion
]


def in_triangle(px, py, a, b, c):
    d1 = (px - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (py - b[1])
    d2 = (px - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (py - c[1])
    d3 = (px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def gem_color(nx, ny):
    """Facet colour at a normalised point, or None outside the stone."""
    x, y = nx / SCALE, ny / SCALE
    for points, color in FACETS:
        if in_triangle(x, y, *points):
            return color
    return None


def background(nx, ny, size):
    dist = min(1.0, math.hypot(nx, ny) / 0.707)
    base = [
        GROUND_OUT[i] + (GROUND_IN[i] - GROUND_OUT[i]) * (1.0 - dist) ** 1.6
        for i in range(3)
    ]
    # amethyst bloom behind the stone
    bloom = max(0.0, 1.0 - math.hypot(nx, ny) / 0.42) ** 2 * 0.5
    return [min(255, base[i] + (GLOW[i] - base[i]) * bloom) for i in range(3)]


def render(size):
    pixels = bytearray(size * size * 4)
    step = size / 14.0          # canvas grid pitch
    dot_r2 = (size / 170.0) ** 2
    inv = 1.0 / (SS * SS)

    for py in range(size):
        row = py * size * 4
        for px in range(size):
            nx = (px + 0.5) / size - 0.5
            ny = (py + 0.5) / size - 0.5
            r, g, b = background(nx, ny, size)

            # faint printed-canvas grid
            gx = (px % step) - step / 2.0
            gy = (py % step) - step / 2.0
            if gx * gx + gy * gy <= dot_r2:
                r += (GRID_DOT[0] - r) * 0.55
                g += (GRID_DOT[1] - g) * 0.55
                b += (GRID_DOT[2] - b) * 0.55

            # supersample the stone so its edges stay clean
            acc = [0.0, 0.0, 0.0]
            hits = 0
            for sy in range(SS):
                sny = (py + (sy + 0.5) / SS) / size - 0.5
                for sx in range(SS):
                    snx = (px + (sx + 0.5) / SS) / size - 0.5
                    facet = gem_color(snx, sny)
                    if facet:
                        acc[0] += facet[0]
                        acc[1] += facet[1]
                        acc[2] += facet[2]
                        hits += 1
            if hits:
                cover = hits * inv
                r = r * (1 - cover) + (acc[0] / hits) * cover
                g = g * (1 - cover) + (acc[1] / hits) * cover
                b = b * (1 - cover) + (acc[2] / hits) * cover

            i = row + px * 4
            pixels[i] = int(max(0, min(255, r)))
            pixels[i + 1] = int(max(0, min(255, g)))
            pixels[i + 2] = int(max(0, min(255, b)))
            pixels[i + 3] = 255
    return pixels


def write_png(path, size, pixels):
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter: none
        raw.extend(pixels[y * stride:(y + 1) * stride])

    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
        + chunk(b'IEND', b'')
    )
    with open(path, 'wb') as fh:
        fh.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, 'icon-%d.png' % size)
        write_png(path, size, render(size))
        print('wrote %s (%d bytes)' % (os.path.relpath(path), os.path.getsize(path)))


if __name__ == '__main__':
    main()
