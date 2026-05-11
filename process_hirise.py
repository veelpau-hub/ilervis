#!/usr/bin/env python3
"""
Script local per processar dades HiRISE de la NASA i generar les sortides per a Ilervis.
Requereix: numpy, Pillow  (+ rasterio per a fitxers GeoTIFF reals)

Descàrrega HiRISE:
  1. https://hirise.lpl.arizona.edu/catalog/  →  cerca "ESP_046060_1985"
  2. Descarrega _RED.JP2  (canal vermell, màxima resolució)
  3. Converteix: gdal_translate -of GTiff ESP_046060_1985_RED.JP2 jezero_red.tif
  4. python process_hirise.py jezero_red.tif

Ús:
  python process_hirise.py <fitxer.tif>    # Processa GeoTIFF real
  python process_hirise.py --sample        # Genera dades d'exemple (sense rasterio)
"""
import argparse
import json
import math
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image


# ── Terrain colormap ──────────────────────────────────────────────────────────

def apply_colormap(arr: np.ndarray) -> np.ndarray:
    """Paleta geològica: blau/verd zones baixes → marró/blanc zones altes."""
    n = arr.astype(float) / 255.0
    r = np.clip(n * 180 + 40,          0, 255).astype(np.uint8)
    g = np.clip((1 - abs(n - 0.5) * 2) * 160 + 50, 0, 255).astype(np.uint8)
    b = np.clip((1 - n) * 200 + 20,    0, 255).astype(np.uint8)
    a = np.full_like(r, 235)
    return np.stack([r, g, b, a], axis=-1)


# ── Elevation profile ─────────────────────────────────────────────────────────

def extract_profile(arr: np.ndarray, n: int = 200) -> list:
    h, w = arr.shape
    xs = np.linspace(0, w - 1, n, dtype=int)
    ys = np.linspace(h // 4, 3 * h // 4, n, dtype=int)
    profile = arr[ys, xs].astype(float)
    scale = (profile - profile.min()) / max(profile.max() - profile.min(), 1)
    return [round(float(v) * 800, 1) for v in scale]  # escala relativa 0-800 m


# ── Segria synthetic reference ────────────────────────────────────────────────

def segria_profile(n: int = 200, seed: int = 42) -> list:
    rng = np.random.default_rng(seed)
    t   = np.linspace(0, 4 * math.pi, n)
    vals = (200 + 40 * np.sin(t * 0.3) + 15 * np.sin(t * 1.1)
            + 8 * np.sin(t * 2.7) + rng.normal(0, 3, n))
    return [round(float(v), 1) for v in vals]


# ── Sample mode ───────────────────────────────────────────────────────────────

def generate_sample(out_dir: Path):
    print("Mode exemple — generant dades sintètiques…")
    rng = np.random.default_rng(42)

    # Mars-like image
    base = rng.normal(128, 28, (512, 512)).astype(float)
    for _ in range(9):
        cx, cy = rng.integers(60, 452, size=2)
        r = rng.integers(18, 75)
        yy, xx = np.ogrid[:512, :512]
        dist = np.hypot(xx - cx, yy - cy)
        rim  = np.exp(-((dist - r) ** 2) / (2 * (r * 0.14) ** 2))
        base += rim * 45
        base[dist < r * 0.8] -= 22

    arr = np.clip(base, 0, 255).astype(np.uint8)
    img_rgba = Image.fromarray(apply_colormap(arr))
    img_rgba.save(str(out_dir / 'mars_jezero.png'), 'PNG', optimize=True)
    print(f"  → {out_dir}/mars_jezero.png")

    # Profiles
    n    = 200
    t    = np.linspace(0, 4 * math.pi, n)
    rng2 = np.random.default_rng(7)
    mars_vals = (400 + 350 * np.exp(-((t - math.pi) ** 2) / 2.5)
                 - 250 * np.exp(-((t - 2 * math.pi) ** 2) / 1.8)
                 + 80 * np.sin(t * 0.8) + rng2.normal(0, 15, n))
    mars_vals = np.clip(mars_vals, 0, 800)

    seg = segria_profile(n)

    profile = {
        'available': True,
        'source':    'sample',
        'segria': {
            'label':  'Segrià, Lleida',
            'unit':   'm s.n.m.',
            'values': seg,
        },
        'mars': {
            'label':  'Cràter Jezero, Mart',
            'unit':   'm (relatiu)',
            'values': [round(float(v), 1) for v in mars_vals],
        },
        'roughness': {
            'segria': round(float(np.std(seg)), 2),
            'mars':   round(float(np.std(mars_vals)), 2),
        },
    }
    with open(out_dir / 'mars_profile.json', 'w') as f:
        json.dump(profile, f, indent=2)
    print(f"  → {out_dir}/mars_profile.json")

    meta = {
        'available':     True,
        'source':        'sample',
        'product_id':    'ESP_046060_1985',
        'location':      'Cràter Jezero, Mart',
        'coordinates_mars': [77.4, 18.4],
        'resolution_cm': 25,
        'processed_at':  datetime.now().isoformat(),
    }
    with open(out_dir / 'mars_metadata.json', 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"  → {out_dir}/mars_metadata.json")
    print("\nFet! Ara: git add static/ && git push")


# ── Real GeoTIFF mode ─────────────────────────────────────────────────────────

def process_tif(tif_path: Path, out_dir: Path, product_id: str):
    try:
        import rasterio
    except ImportError:
        sys.exit("ERROR: pip install rasterio  (necessari per a GeoTIFF reals)")

    print(f"Processant {tif_path}…")
    with rasterio.open(tif_path) as src:
        data   = src.read(1).astype(float)
        bounds = [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top]
        crs    = str(src.crs)
        nodata = src.nodata

    mask = data != nodata if nodata is not None else data > -9999
    p2, p98 = np.percentile(data[mask], [2, 98]) if mask.any() else (data.min(), data.max())
    arr = np.clip((data - p2) / max(p98 - p2, 1) * 255, 0, 255).astype(np.uint8)

    Image.fromarray(apply_colormap(arr)).save(
        str(out_dir / 'mars_jezero.png'), 'PNG', optimize=True
    )
    print(f"  → {out_dir}/mars_jezero.png")

    mars_vals = extract_profile(arr)
    seg = segria_profile()

    profile = {
        'available': True,
        'source':    'hirise',
        'segria': {
            'label':  'Segrià, Lleida',
            'unit':   'm s.n.m.',
            'values': seg,
        },
        'mars': {
            'label':  'Cràter Jezero, Mart',
            'unit':   'm (relatiu)',
            'values': mars_vals,
        },
        'roughness': {
            'segria': round(float(np.std(seg)), 2),
            'mars':   round(float(np.std(mars_vals)), 2),
        },
    }
    with open(out_dir / 'mars_profile.json', 'w') as f:
        json.dump(profile, f, indent=2)

    meta = {
        'available':     True,
        'source':        'hirise',
        'product_id':    product_id,
        'location':      'Cràter Jezero, Mart',
        'coordinates_mars': [77.4, 18.4],
        'bounds_file':   bounds,
        'crs':           crs,
        'resolution_cm': 25,
        'processed_at':  datetime.now().isoformat(),
    }
    with open(out_dir / 'mars_metadata.json', 'w') as f:
        json.dump(meta, f, indent=2)

    print(f"  → {out_dir}/mars_profile.json")
    print(f"  → {out_dir}/mars_metadata.json")
    print("\nFet! Ara: git add static/ && git push")


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Processa HiRISE per a Ilervis')
    ap.add_argument('input',     nargs='?', help='GeoTIFF HiRISE (opcional)')
    ap.add_argument('--sample',  action='store_true', help='Genera dades d\'exemple')
    ap.add_argument('--out',     default='static', help='Directori de sortida')
    ap.add_argument('--product', default='ESP_046060_1985', help='Product ID HiRISE')
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(exist_ok=True)

    if args.sample:
        generate_sample(out)
    elif args.input:
        process_tif(Path(args.input), out, args.product)
    else:
        ap.print_help()
        sys.exit(1)


if __name__ == '__main__':
    main()
