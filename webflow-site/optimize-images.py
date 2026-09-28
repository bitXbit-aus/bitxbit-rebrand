#!/usr/bin/env /usr/bin/python3
"""Optimize hero/project images for the bitXbit marketing site.

Place source images in images/raw/ (PNG/JPG), then run:

    python3 optimize-images.py

Outputs:
    images/optimized/<name>-<width>.webp
    images/optimized/<name>-<width>.avif
    images/optimized/<name>.webp  (original size)
    images/optimized/<name>.avif  (original size)

The script also prints a ready-to-paste <picture> snippet for each image.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from PIL import Image

try:
    import pillow_avif  # noqa: F401 — registers AVIF support with Pillow
except ImportError:
    raise RuntimeError(
        "AVIF support not available. Install with:\n"
        "  /usr/bin/python3 -m pip install pillow-avif-plugin"
    )

RAW_DIR = Path("images/raw")
OUT_DIR = Path("images/optimized")
DEFAULT_WIDTHS = (400, 800, 1200)
SUPPORTED = (".png", ".jpg", ".jpeg")


def ensure_clean_output() -> None:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    OUT_DIR.mkdir(parents=True, exist_ok=True)


def save_variant(img: Image.Image, out_path: Path, quality: int = 85) -> None:
    if out_path.suffix == ".webp":
        img.save(out_path, "WEBP", quality=quality, method=6)
    elif out_path.suffix == ".avif":
        img.save(out_path, "AVIF", quality=quality)


def optimize_source(src_path: Path) -> list[Path]:
    name = src_path.stem
    img = Image.open(src_path)

    # Convert palette/images to RGB/RGBA for consistent output.
    if img.mode in ("P", "LA", "L"):
        img = img.convert("RGBA" if "A" in img.mode or img.mode == "P" else "RGB")

    generated: list[Path] = []

    # Original-size variants.
    for ext in (".webp", ".avif"):
        out_path = OUT_DIR / f"{name}{ext}"
        save_variant(img, out_path)
        generated.append(out_path)

    # Responsive width variants.
    orig_w, orig_h = img.size
    for width in DEFAULT_WIDTHS:
        if width >= orig_w:
            continue
        ratio = width / orig_w
        height = max(1, int(orig_h * ratio))
        resized = img.resize((width, height), Image.LANCZOS)
        for ext in (".webp", ".avif"):
            out_path = OUT_DIR / f"{name}-{width}{ext}"
            save_variant(resized, out_path)
            generated.append(out_path)

    return generated


def picture_snippet(name: str, alt: str, widths: tuple[int, ...]) -> str:
    srcset_webp = ", ".join(f"images/optimized/{name}-{w}.webp {w}w" for w in widths)
    srcset_avif = ", ".join(f"images/optimized/{name}-{w}.avif {w}w" for w in widths)
    default_webp = f"images/optimized/{name}.webp"
    return (
        f'<picture>\n'
        f'  <source srcset="{srcset_avif}" sizes="(max-width: 768px) 100vw, 800px" type="image/avif">\n'
        f'  <source srcset="{srcset_webp}" sizes="(max-width: 768px) 100vw, 800px" type="image/webp">\n'
        f'  <img src="{default_webp}" alt="{alt}" loading="lazy" decoding="async" width="800" height="450">\n'
        f'</picture>'
    )


def main() -> None:
    if not RAW_DIR.exists():
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print(f"Created {RAW_DIR}. Add source images there and re-run.")
        return

    ensure_clean_output()

    files = sorted(p for p in RAW_DIR.iterdir() if p.suffix.lower() in SUPPORTED)
    if not files:
        print(f"No images found in {RAW_DIR}.")
        return

    for src in files:
        print(f"\nOptimizing: {src}")
        generated = optimize_source(src)
        for out in generated:
            size_kb = out.stat().st_size / 1024
            print(f"  {out} ({size_kb:.1f} KB)")
        print("\nPaste this into your HTML:")
        print(picture_snippet(src.stem, alt=src.stem.replace("-", " ").title(), widths=DEFAULT_WIDTHS))


if __name__ == "__main__":
    main()
