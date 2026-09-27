#!/usr/bin/env python3
"""
geo_convert.py - convert geospatial files using GeoPandas.

Usage:
    python geo_convert.py <input> <output> [--crs EPSG:4326] [--layer LAYER]

Supports any format GeoPandas/Fiona can read (Shapefile, GeoJSON, GPKG, KML,
GML) and writing to any of those, inferred from the output file extension.
CSV input is supported if it has 'lat'/'lon' (or 'latitude'/'longitude' or
'x'/'y') columns; CSV output writes WKT geometry plus attribute columns.
"""
import argparse
import os
import sys

import geopandas as gpd
import pandas as pd


def read_input(input_path):
    ext = os.path.splitext(input_path)[1].lower()
    if ext == '.csv':
        df = pd.read_csv(input_path)
        lat_col = next((c for c in df.columns if c.lower() in ('lat', 'latitude', 'y')), None)
        lon_col = next((c for c in df.columns if c.lower() in ('lon', 'lng', 'longitude', 'x')), None)
        if not lat_col or not lon_col:
            raise ValueError("CSV input needs latitude/longitude (or x/y) columns.")
        gdf = gpd.GeoDataFrame(
            df,
            geometry=gpd.points_from_xy(df[lon_col], df[lat_col]),
            crs='EPSG:4326',
        )
        return gdf
    return gpd.read_file(input_path)


def write_output(gdf, output_path):
    ext = os.path.splitext(output_path)[1].lower()
    if ext == '.csv':
        out = gdf.copy()
        out['geometry'] = out['geometry'].apply(lambda g: g.wkt if g is not None else '')
        out.to_csv(output_path, index=False)
        return
    if ext == '.shp':
        gdf.to_file(output_path, driver='ESRI Shapefile')
        return
    if ext in ('.geojson', '.json'):
        gdf.to_file(output_path, driver='GeoJSON')
        return
    if ext == '.gpkg':
        gdf.to_file(output_path, driver='GPKG')
        return
    if ext == '.kml':
        gdf.to_file(output_path, driver='KML')
        return
    # Fallback: let GeoPandas/Fiona guess from extension.
    gdf.to_file(output_path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input')
    parser.add_argument('output')
    parser.add_argument('--crs', default=None, help='Target CRS, e.g. EPSG:4326 or EPSG:3857')
    parser.add_argument('--layer', default=None, help='Layer name for multi-layer inputs (e.g. GPKG)')
    args = parser.parse_args()

    kwargs = {}
    if args.layer:
        kwargs['layer'] = args.layer

    if os.path.splitext(args.input)[1].lower() == '.csv':
        gdf = read_input(args.input)
    else:
        gdf = gpd.read_file(args.input, **kwargs)

    if args.crs:
        if gdf.crs is None:
            gdf = gdf.set_crs('EPSG:4326')
        gdf = gdf.to_crs(args.crs)

    write_output(gdf, args.output)
    print(f"Converted {len(gdf)} feature(s) -> {args.output}")


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
