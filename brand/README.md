# Brand assets

`logo-master.png` is the **only** source of the mark. Everything in `static/`
that carries the logo is generated from it:

```sh
pip install 'Pillow>=10,<12'
python3 scripts/gen-brand-assets.py          # regenerate static/
python3 scripts/gen-brand-assets.py --check  # verify (runs in CI)
```

What to produce, at which sizes and over which background, lives in
`assets.json`. The script is the same in every repository that serves the mark;
only the manifest differs.

## Why a pipeline rather than files by hand

An image uploaded in a chat that becomes an asset served by the UI crosses a
trust boundary (clodia-platform#101). The master comes from `gpt-image` and
carries a `caBX` chunk — a C2PA manifest of about 25 KB: provenance,
certificates, `instanceID` — which has no business reaching production. Every
output is therefore **re-decoded and rewritten from scratch**, never copied:
only `IHDR`, `IDAT` and `IEND` survive.

`--check` fails CI if an asset is updated by hand, bypassing the re-encode, or
if a committed PNG reintroduces metadata or bytes after `IEND`.

## Two variants of the banner

The lockup is designed for a dark background: the wordmark is cream (`#e1dccf`),
which on white gives a contrast ratio of 1.2:1. The pipeline therefore also
generates `clodia-brand-banner-light.png`, in which the **colour** of the
wordmark is replaced with the mark's ink while the alpha channel is left intact
— shape and antialiasing stay those of the master. Which variant to use is
chosen at runtime in `src/lib/brand.ts`, from the active theme.

## If the master changes

The crop windows in `assets.json` are fixed coordinates on the master. The
script compares the bounding box of the content with `geometry.content_bbox` and
**fails** when they do not match, rather than producing favicons cropped at
random. Recompute the geometry before regenerating.
