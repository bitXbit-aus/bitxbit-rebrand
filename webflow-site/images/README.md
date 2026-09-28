# bitXbit Marketing Site Images

## Favicons

Generated from `images/logo-source.png` by `generate-favicons.py`.

To regenerate after updating the source logo:

```bash
cd webflow-site
python3 generate-favicons.py
```

## Hero / Project Images

1. Drop source PNG/JPG files into `images/raw/`.
2. Run the optimizer:

```bash
cd webflow-site
python3 optimize-images.py
```

3. The script outputs WebP/AVIF variants to `images/optimized/` and prints a ready-to-paste `<picture>` snippet.

## Lazy Loading

All dynamic images (project thumbnails, partner logos) use `loading="lazy"` and `decoding="async"`. For any new static `<img>`, add these attributes unless the image is above the fold.
