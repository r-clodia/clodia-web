#!/usr/bin/env python3
"""Genera gli asset di brand (favicon, icone, banner, social card) dal master.

Sorgente unica: `brand/logo-master.png`. Cosa produrre e con quale geometria è
descritto in `brand/assets.json`, così questo script resta identico in tutti i
repository che servono il marchio.

Requisito di sicurezza (clodia-platform#101): **nessun PNG viene copiato as-is**.
Ogni output è ridecodificato pixel-per-pixel e riscritto da zero partendo da un
buffer nuovo, quindi metadata EXIF/C2PA, chunk non standard (il master generato
da `gpt-image` porta un `caBX` da ~25 KB) e qualunque payload appeso dopo `IEND`
non possono sopravvivere fino a produzione. `audit_png()` verifica il risultato e
fa fallire il build se un chunk non ammesso ricompare.

Uso:
    python3 scripts/gen-brand-assets.py            # rigenera gli asset in static/
    python3 scripts/gen-brand-assets.py --check    # verifica, non scrive (CI)

Dipendenza: Pillow (>=10).
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent

# Chunk ammessi in un PNG servito in produzione: solo quelli necessari a
# decodificare l'immagine. Tutto il resto (eXIf, caBX/C2PA, tEXt, iTXt, zTXt,
# pHYs, ...) è metadata che non ha ragione di uscire dalla build.
ALLOWED_CHUNKS = {"IHDR", "PLTE", "tRNS", "IDAT", "IEND"}
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


# --------------------------------------------------------------------------- #
# audit
# --------------------------------------------------------------------------- #
def png_chunks(data: bytes) -> tuple[list[str], int]:
    """Ritorna (tipi di chunk in ordine, byte in coda dopo IEND)."""
    if data[:8] != PNG_MAGIC:
        raise ValueError("firma PNG assente")
    offset = 8
    chunks: list[str] = []
    while offset + 8 <= len(data):
        (length,) = struct.unpack(">I", data[offset : offset + 4])
        ctype = data[offset + 4 : offset + 8].decode("ascii", "replace")
        chunks.append(ctype)
        offset += 12 + length
        if ctype == "IEND":
            break
    else:
        raise ValueError("catena di chunk troncata: IEND non raggiunto")
    return chunks, len(data) - offset


def audit_png(data: bytes, label: str) -> list[str]:
    """Elenca i problemi di igiene del PNG (lista vuota = pulito)."""
    problems: list[str] = []
    try:
        chunks, tail = png_chunks(data)
    except ValueError as exc:
        return [f"{label}: {exc}"]
    unexpected = [c for c in dict.fromkeys(chunks) if c not in ALLOWED_CHUNKS]
    if unexpected:
        problems.append(f"{label}: chunk non ammessi {unexpected}")
    if tail:
        problems.append(f"{label}: {tail} byte appesi dopo IEND")
    return problems


# --------------------------------------------------------------------------- #
# helper immagine
# --------------------------------------------------------------------------- #
def strip(img: Image.Image) -> Image.Image:
    """Copia i soli pixel in un'immagine nuova, senza `.info` (metadata)."""
    img = img.convert("RGBA")
    return Image.frombytes("RGBA", img.size, img.tobytes())


def hex_rgba(value: str | None) -> tuple[int, int, int, int]:
    if value is None:
        return (0, 0, 0, 0)
    v = value.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), 255)


def encode_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    strip(img).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def encode_ico(img: Image.Image, sizes: list[int]) -> bytes:
    buf = io.BytesIO()
    strip(img).save(buf, format="ICO", sizes=[(s, s) for s in sizes])
    return buf.getvalue()


def contain(img: Image.Image, box_w: int, box_h: int) -> Image.Image:
    scale = min(box_w / img.width, box_h / img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, Image.LANCZOS)


def canvas_with(img: Image.Image, width: int, height: int, bg: str | None) -> Image.Image:
    out = Image.new("RGBA", (width, height), hex_rgba(bg))
    out.alpha_composite(img, ((width - img.width) // 2, (height - img.height) // 2))
    return out


def recolor_for_light(lockup: Image.Image, x_from: int, ink: str, accent: str) -> Image.Image:
    """Ricolora la sola wordmark per l'uso su fondo chiaro.

    Il master è disegnato per fondo scuro: la scritta è crema (#e1dccf), che su
    bianco dà 1.2:1 di contrasto — illeggibile. Qui sostituiamo il *colore* dei
    pixel della wordmark lasciando intatto il canale alpha, così l'antialiasing
    e la forma delle lettere restano identici al master. Il ritratto (x < x_from)
    non viene toccato: ha già il suo contrasto su entrambi i fondi.
    """
    out = lockup.copy()
    px = out.load()
    ink_rgb, accent_rgb = hex_rgba(ink)[:3], hex_rgba(accent)[:3]
    for y in range(out.height):
        for x in range(x_from, out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            # il ".dev" è verde-acqua (g > r), il resto della wordmark è crema
            px[x, y] = (*(accent_rgb if g > r + 4 else ink_rgb), a)
    return out


# --------------------------------------------------------------------------- #
# build
# --------------------------------------------------------------------------- #
def load_manifest() -> dict:
    return json.loads((REPO / "brand" / "assets.json").read_text(encoding="utf-8"))


def load_master(manifest: dict) -> Image.Image:
    path = REPO / manifest["master"]
    raw = path.read_bytes()
    master = strip(Image.open(io.BytesIO(raw)))
    geom = manifest["geometry"]
    expected = tuple(geom["master_size"])
    if master.size != expected:
        raise SystemExit(f"master {path}: attese {expected}, trovate {master.size}")
    # Le finestre di crop sono coordinate fisse sul master: se il master viene
    # sostituito con un'immagine composta diversamente, i ritagli sarebbero
    # silenziosamente sbagliati. Qui il build fallisce invece di produrre
    # favicon storte.
    bbox = master.split()[3].point(lambda v: 255 if v >= 128 else 0).getbbox()
    if list(bbox) != geom["content_bbox"]:
        raise SystemExit(
            f"master {path}: contenuto in {list(bbox)}, atteso {geom['content_bbox']}.\n"
            "Il master è cambiato: ricalcola geometry in brand/assets.json."
        )
    return master


def render(manifest: dict, master: Image.Image) -> dict[str, bytes]:
    geom, palette = manifest["geometry"], manifest["palette"]
    icon = master.crop(tuple(geom["icon_box"]))
    lockup_dark = master.crop(tuple(geom["lockup_box"]))
    lockup_light = None  # calcolato solo se serve (il ricoloro costa un pass)

    out: dict[str, bytes] = {}
    for t in manifest["targets"]:
        kind = t["kind"]
        if kind == "icon":
            size = t["size"]
            inner = contain(icon, round(size * t["inset"]), round(size * t["inset"]))
            out[t["file"]] = encode_png(canvas_with(inner, size, size, t.get("bg")))
        elif kind == "ico":
            size = max(t["sizes"])
            inner = contain(icon, round(size * t["inset"]), round(size * t["inset"]))
            out[t["file"]] = encode_ico(
                canvas_with(inner, size, size, t.get("bg")), t["sizes"]
            )
        elif kind == "lockup":
            w, h, pad = t["width"], t["height"], t["pad"]
            if t.get("variant") == "light":
                if lockup_light is None:
                    lockup_light = recolor_for_light(
                        lockup_dark, geom["wordmark_x"], palette["ink"], palette["accent_ink"]
                    )
                src = lockup_light
            else:
                src = lockup_dark
            inner = contain(src, round(w * (1 - 2 * pad)), round(h * (1 - 2 * pad)))
            out[t["file"]] = canvas_with(inner, w, h, t.get("bg"))
            out[t["file"]] = encode_png(out[t["file"]])
        else:
            raise SystemExit(f"target {t['file']}: kind sconosciuto {kind!r}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--check",
        action="store_true",
        help="non scrive: verifica che gli asset committati siano quelli che la "
        "pipeline produce e che siano privi di metadata",
    )
    args = ap.parse_args()

    manifest = load_manifest()
    out_dir = REPO / manifest["out_dir"]
    rendered = render(manifest, load_master(manifest))

    problems: list[str] = []
    problems += audit_png((REPO / manifest["master"]).read_bytes(), manifest["master"])
    for name, data in rendered.items():
        if name.endswith(".png"):
            problems += audit_png(data, f"generato {name}")
    if problems:
        print("Igiene PNG violata:", *problems, sep="\n  - ", file=sys.stderr)
        return 1

    if args.check:
        drift: list[str] = []
        for name, data in rendered.items():
            path = out_dir / name
            if not path.exists():
                drift.append(f"{name}: mancante")
                continue
            committed = path.read_bytes()
            if name.endswith(".png"):
                problems += audit_png(committed, f"committato {name}")
            # Il confronto è sui pixel, non sui byte: encoder di versione diversa
            # comprimono in modo diverso a parità di immagine. La deriva che ci
            # interessa (asset aggiornato a mano, scavalcando il re-encode) cambia
            # i pixel; i metadata reintrodotti li prende l'audit qui sopra.
            a, b = Image.open(io.BytesIO(committed)), Image.open(io.BytesIO(data))
            if a.size != b.size:
                drift.append(f"{name}: {a.size} committata, {b.size} attesa")
            elif a.convert("RGBA").tobytes() != b.convert("RGBA").tobytes():
                drift.append(f"{name}: i pixel non corrispondono al master")
        if problems:
            print("Igiene PNG violata:", *problems, sep="\n  - ", file=sys.stderr)
        if drift:
            print(
                "Asset non allineati al master. Esegui "
                "`python3 scripts/gen-brand-assets.py` e committa il risultato:",
                *drift,
                sep="\n  - ",
                file=sys.stderr,
            )
        if problems or drift:
            return 1
        print(f"OK: {len(rendered)} asset allineati al master e privi di metadata.")
        return 0

    for name, data in sorted(rendered.items()):
        (out_dir / name).write_bytes(data)
        print(f"  {manifest['out_dir']}/{name}  {len(data):,d} B")
    print(f"OK: {len(rendered)} asset rigenerati da {manifest['master']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
