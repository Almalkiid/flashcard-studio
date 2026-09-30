"""Draws tests/e2e/vault/CIA/Part1/Heart.png, the picture of the image occlusion end-to-end test: a schematic of the
four chambers of the heart as four labelled boxes. Every shape and word is drawn here, no picture is downloaded.

    python3 tests/e2e/fixtures/build-heart-image.py

Prints the box of each label as fractions of the picture (x, y, w, h), which is what a mask needs.
"""

import json
import os

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 1000, 640
OUT = os.path.join(os.path.dirname(__file__), "..", "vault", "CIA", "Part1", "Heart.png")

FONT_FILES = [
    ("/System/Library/Fonts/Helvetica.ttc", 1),  # bold
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1),
    ("/Library/Fonts/Arial Bold.ttf", 0),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path, index in FONT_FILES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size, index=index)
    return ImageFont.load_default(size)


BOXES = [
    # label, left, top, colour, edge
    ("Right atrium", 80, 130, (214, 233, 255), (70, 125, 200)),
    ("Left atrium", 540, 130, (255, 226, 214), (205, 110, 70)),
    ("Right ventricle", 80, 390, (219, 244, 226), (70, 160, 105)),
    ("Left ventricle", 540, 390, (240, 226, 252), (140, 90, 190)),
]
BOX_W, BOX_H = 380, 170


def arrow(draw: ImageDraw.ImageDraw, start, end, colour) -> None:
    draw.line([start, end], fill=colour, width=6)
    (x1, y1), (x2, y2) = start, end
    if x1 == x2:  # vertical
        d = 1 if y2 > y1 else -1
        draw.polygon([(x2, y2 + 14 * d), (x2 - 14, y2 - 6 * d), (x2 + 14, y2 - 6 * d)], fill=colour)
    else:
        d = 1 if x2 > x1 else -1
        draw.polygon([(x2 + 14 * d, y2), (x2 - 6 * d, y2 - 14), (x2 - 6 * d, y2 + 14)], fill=colour)


def main() -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), (248, 250, 252))
    draw = ImageDraw.Draw(image)

    title = font(30)
    draw.text((WIDTH // 2, 58), "Heart chambers, schematic", font=title, fill=(71, 85, 105), anchor="mm")

    labels = font(38)
    boxes = {}
    for label, left, top, fill, edge in BOXES:
        draw.rounded_rectangle(
            [left, top, left + BOX_W, top + BOX_H], radius=28, fill=fill, outline=edge, width=5
        )
        cx, cy = left + BOX_W // 2, top + BOX_H // 2
        draw.text((cx, cy), label, font=labels, fill=(15, 23, 42), anchor="mm")
        x0, y0, x1, y1 = draw.textbbox((cx, cy), label, font=labels, anchor="mm")
        pad = 14
        boxes[label] = [
            round((x0 - pad) / WIDTH, 4),
            round((y0 - pad) / HEIGHT, 4),
            round((x1 - x0 + 2 * pad) / WIDTH, 4),
            round((y1 - y0 + 2 * pad) / HEIGHT, 4),
        ]

    flow = (100, 116, 139)
    arrow(draw, (270, 300), (270, 384), flow)  # right atrium down to right ventricle
    arrow(draw, (730, 300), (730, 384), flow)  # left atrium down to left ventricle
    draw.text((WIDTH // 2, 320), "blood flow", font=font(24), fill=(100, 116, 139), anchor="mm")

    image.save(OUT, optimize=True)
    print(json.dumps(boxes, indent=2))


main()
