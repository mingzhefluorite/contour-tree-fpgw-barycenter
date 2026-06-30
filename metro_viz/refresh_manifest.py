"""
Rescan metro_viz/data/*.json and rewrite data/manifest.json.
Run after adding JSON files without running prepare_data.py.
"""
from pathlib import Path

from prepare_data import write_data_manifest

if __name__ == "__main__":
    write_data_manifest(Path(__file__).resolve().parent / "data")
