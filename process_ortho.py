#!/usr/bin/env python3
"""
Script local per processar l'ortofoto de WebODM i preparar-la per a Ilervis.
Requereix: rasterio, numpy, Pillow  (pip install rasterio numpy Pillow)
Requereix GDAL instal·lat al sistema.

Ús:
  python process_ortho.py odm_orthophoto.tif
  python process_ortho.py odm_orthophoto.tif --vari --dsm dsm.tif --out static/
"""
import argparse
import colorsys
import json
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import rasterio
    from rasterio.crs import CRS
    from rasterio.warp import calculate_default_transform, reproject, Resampling
except ImportError:
    sys.exit("ERROR: pip install rasterio")


def reproject_to_wgs84(src_path: Path, dst_path: Path) -> Path:
    with rasterio.open(src_path) as src:
        dst_crs = CRS.from_epsg(4326)
        transform, w, h = calculate_default_transform(
            src.crs, dst_crs, src.width, src.height, *src.bounds
        )
        profile = src.profile.copy()
        profile.update(crs=dst_crs, transform=transform, width=w, height=h)
        with rasterio.open(dst_path, 'w', **profile) as dst:
            for i in range(1, src.count + 1):
                reproject(
                    source=rasterio.band(src, i),
                    destination=rasterio.band(dst, i),
                    src_transform=src.transform, src_crs=src.crs,
                    dst_transform=transform, dst_crs=dst_crs,
                    resampling=Resampling.lanczos,
                )
    return dst_path


def tif_to_png(tif_path: Path, png_path: Path) -> tuple:
    with rasterio.open(tif_path) as src:
        bounds = [src.bounds.left, src.bounds.bottom, src.bounds.right, src.bounds.top]
        bands  = src.count
        native_res = abs(src.transform[0])
        area_m2    = src.width * src.height * native_res ** 2
        data = src.read(list(range(1, min(bands, 3) + 1)))

    out = []
    for band in data:
        valid = band[band > 0]
        p2, p98 = (np.percentile(valid, [2, 98]) if valid.size else (0, 255))
        scaled = np.clip((band.astype(float) - p2) / max(p98 - p2, 1) * 255, 0, 255).astype(np.uint8)
        out.append(scaled)

    mode = 'RGB' if len(out) == 3 else 'L'
    img  = Image.fromarray(np.stack(out, axis=-1) if len(out) > 1 else out[0], mode)
    img.save(str(png_path), 'PNG', optimize=True)
    return bounds, round(native_res * 100, 2), round(area_m2 / 10000, 2)


def vari_to_png(tif_path: Path, png_path: Path):
    with rasterio.open(tif_path) as src:
        if src.count < 3:
            sys.exit("ERROR: necessita imatge RGB (≥3 bandes)")
        r = src.read(1).astype(float)
        g = src.read(2).astype(float)
        b = src.read(3).astype(float)

    denom = g + r - b
    denom[denom == 0] = 1e-6
    vari  = np.clip((g - r) / denom, -1, 0.5)
    norm  = (vari + 1) / 1.5  # 0→1

    rgba = np.zeros((*vari.shape, 4), dtype=np.uint8)
    hue  = norm * (120 / 360)  # 0° (red) → 120° (green)
    for y in range(vari.shape[0]):
        for x in range(vari.shape[1]):
            if r[y, x] == 0 and g[y, x] == 0:
                continue
            rv, gv, bv = colorsys.hsv_to_rgb(hue[y, x], 0.85, 0.9)
            rgba[y, x] = [int(rv * 255), int(gv * 255), int(bv * 255), 200]

    Image.fromarray(rgba, 'RGBA').save(str(png_path), 'PNG')
    print(f"  → {png_path}")


def main():
    ap = argparse.ArgumentParser(description='Processa ortofoto WebODM per a Ilervis')
    ap.add_argument('input', help='GeoTIFF d\'entrada (odm_orthophoto.tif)')
    ap.add_argument('--vari',  action='store_true', help='Genera PNG de VARI')
    ap.add_argument('--dsm',   help='DSM GeoTIFF per a comparativa Mart')
    ap.add_argument('--out',   default='static', help='Directori de sortida')
    ap.add_argument('--location', default='Segrià, Lleida')
    ap.add_argument('--date',  default=datetime.now().strftime('%Y-%m-%d'))
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        sys.exit(f"ERROR: no trobat: {src}")

    out = Path(args.out)
    out.mkdir(exist_ok=True)

    print("Reprojectant a WGS84…")
    reprojected = out / '_ortofoto_wgs84.tif'
    reproject_to_wgs84(src, reprojected)

    print("Convertint a PNG…")
    bounds, gsd_cm, area_ha = tif_to_png(reprojected, out / 'ortofoto_segria.png')
    print(f"  → {out}/ortofoto_segria.png  bounds={bounds}")

    if args.vari:
        print("Calculant VARI…")
        vari_to_png(reprojected, out / 'vari_segria.png')

    meta = {
        'available':      True,
        'type':           'orthophoto',
        'location':       args.location,
        'date':           args.date,
        'bounds':         bounds,
        'gsd_cm':         gsd_cm,
        'area_ha':        area_ha,
        'vari_available': args.vari,
        'processed_at':   datetime.now().isoformat(),
    }
    with open(out / 'fotogrametria_metadata.json', 'w') as f:
        json.dump(meta, f, indent=2)
    print(f"  → {out}/fotogrametria_metadata.json")
    print("\nFet! Ara: git add static/ && git push")


if __name__ == '__main__':
    main()
