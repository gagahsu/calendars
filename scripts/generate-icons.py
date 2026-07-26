#!/usr/bin/env python3
"""Generate the PWA icon set.

Pure stdlib (zlib + struct) so there is no Pillow/sharp dependency. Draws a
rounded indigo tile with a simple calendar glyph, which is all a home-screen
icon needs to be recognisable.

Usage: python3 scripts/generate-icons.py
"""

import struct
import zlib
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "icons"

BG_TOP = (0x4F, 0x63, 0xD2)
BG_BOTTOM = (0x6D, 0x8C, 0xFF)
INK = (0xFF, 0xFF, 0xFF)
ACCENT = (0xFF, 0xB4, 0x54)


def lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def rounded_box(x: float, y: float, w: float, h: float, r: float, px: float, py: float) -> bool:
    """Is (px, py) inside the rounded rectangle?"""
    if not (x <= px <= x + w and y <= py <= y + h):
        return False
    for cx, cy in ((x + r, y + r), (x + w - r, y + r), (x + r, y + h - r), (x + w - r, y + h - r)):
        # Only the corner quadrants need the radius test.
        if (px < x + r or px > x + w - r) and (py < y + r or py > y + h - r):
            if (px - cx) ** 2 + (py - cy) ** 2 <= r * r:
                return True
        else:
            return True
    return False


def draw(size: int, *, maskable: bool) -> bytes:
    """Return raw RGBA rows for one icon."""
    # Maskable icons get squeezed so nothing important lands in the safe-zone
    # crop that Android applies.
    scale = 0.68 if maskable else 0.84
    glyph = size * scale
    gx = (size - glyph) / 2
    gy = (size - glyph) / 2

    # Calendar body geometry, in glyph-relative units.
    body_x = gx + glyph * 0.06
    body_y = gy + glyph * 0.16
    body_w = glyph * 0.88
    body_h = glyph * 0.78
    radius = glyph * 0.11
    header_h = body_h * 0.24

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px, py = x + 0.5, y + 0.5

            # Background: rounded tile with a vertical gradient. Full-bleed for
            # maskable, inset rounded square for the regular icon.
            t = y / max(1, size - 1)
            bg = (
                lerp(BG_TOP[0], BG_BOTTOM[0], t),
                lerp(BG_TOP[1], BG_BOTTOM[1], t),
                lerp(BG_TOP[2], BG_BOTTOM[2], t),
            )
            if maskable:
                colour, alpha = bg, 255
            elif rounded_box(0, 0, size - 1, size - 1, size * 0.22, px, py):
                colour, alpha = bg, 255
            else:
                colour, alpha = (0, 0, 0), 0

            if alpha:
                # Calendar card.
                if rounded_box(body_x, body_y, body_w, body_h, radius, px, py):
                    colour = INK
                    # Header band.
                    if py <= body_y + header_h:
                        colour = ACCENT
                    else:
                        # Grid of day cells: 4 columns x 3 rows of gaps.
                        inner_y = py - (body_y + header_h)
                        inner_x = px - body_x
                        cell_w = body_w / 4
                        cell_h = (body_h - header_h) / 3
                        col = inner_x / cell_w % 1
                        rowf = inner_y / cell_h % 1
                        margin = 0.22
                        if margin < col < 1 - margin and margin < rowf < 1 - margin:
                            colour = bg
                # Binder rings poking above the card.
                ring_y = body_y - glyph * 0.02
                for offset in (0.28, 0.72):
                    ring_x = body_x + body_w * offset
                    if (px - ring_x) ** 2 + (py - ring_y) ** 2 <= (glyph * 0.055) ** 2:
                        colour = INK

            row += bytes((colour[0], colour[1], colour[2], alpha))
        rows.append(bytes(row))
    return b"".join(b"\x00" + r for r in rows)


def write_png(path: Path, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">2I5B", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"wrote {path.relative_to(path.parents[2])} ({len(png):,} bytes)")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("apple-touch-icon.png", 180, True),  # iOS has no rounding of its own
        ("maskable-512.png", 512, True),
    ]
    for name, size, maskable in targets:
        write_png(OUT_DIR / name, size, draw(size, maskable=maskable))


if __name__ == "__main__":
    main()
