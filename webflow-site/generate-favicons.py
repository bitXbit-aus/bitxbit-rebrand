#!/usr/bin/env python3
"""Generate a complete favicon set from images/logo-source.png.

Run from the webflow-site directory:
    python3 generate-favicons.py

Outputs:
    favicon.ico (multi-resolution)
    favicon-16x16.png
    favicon-32x32.png
    favicon-96x96.png
    apple-touch-icon.png (180x180)
    android-chrome-192x192.png
    android-chrome-512x512.png
    site.webmanifest
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image

SOURCE = Path("images/logo-source.png")
OUT_DIR = Path(".")

SIZES = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "favicon-96x96.png": 96,
    "apple-touch-icon.png": 180,
    "android-chrome-192x192.png": 192,
    "android-chrome-512x512.png": 512,
}

ICO_SIZES = [16, 32, 48]


def generate() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Source logo not found: {SOURCE}")

    img = Image.open(SOURCE).convert("RGBA")

    # Square canvas with centered logo, scaled to fill ~80% of canvas.
    def render(size: int) -> Image.Image:
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # Scale logo to 80% of canvas, preserving aspect ratio.
        logo_w, logo_h = img.size
        scale = min(size * 0.8 / logo_w, size * 0.8 / logo_h)
        new_w = max(1, int(logo_w * scale))
        new_h = max(1, int(logo_h * scale))
        scaled = img.resize((new_w, new_h), Image.LANCZOS)
        x = (size - new_w) // 2
        y = (size - new_h) // 2
        canvas.paste(scaled, (x, y), scaled)
        return canvas

    for filename, size in SIZES.items():
        out_path = OUT_DIR / filename
        render(size).save(out_path)
        print(f"Generated {out_path}")

    # Multi-resolution ICO
    ico_path = OUT_DIR / "favicon.ico"
    ico_images = [render(s) for s in ICO_SIZES]
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=[(i.width, i.height) for i in ico_images],
        append_images=ico_images[1:],
    )
    print(f"Generated {ico_path}")

    # Web manifest
    manifest = {
        "name": "bitXbit",
        "short_name": "bitXbit",
        "description": "Turn everyday referrals into shared digital abundance.",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#0A0E1A",
        "theme_color": "#0A0E1A",
        "icons": [
            {"src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png"},
        ],
    }
    manifest_path = OUT_DIR / "site.webmanifest"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Generated {manifest_path}")


if __name__ == "__main__":
    generate()
