# Uncertainty Visualization for Approximated Barycenter of Contour Trees Based on Partial Optimal Transport

This repository accompanies the paper:

**Uncertainty Visualization for Approximated Barycenter of Contour Trees Based on Partial Optimal Transport**  
Mingzhe Li, Fangfei Lan, Gunther Weber, Bei Wang

It implements a pipeline that (1) computes an approximated barycenter of a family of contour trees using fused partial Gromov-Wasserstein (FGW) metric, and (2) visualizes structural and functional uncertainty in an interactive metro-map view.

## Pipeline overview

```
Contour-tree .txt files          Notebook (FGW barycenter)         prepare_data.py          Web viewer
───────────────────────   →   ─────────────────────────────   →   ─────────────────   →   ─────────────
data/<dataset>/                barycenter_export/<dataset>/        metro_viz/data/          metro_viz/
  treeNodes_*.txt                G_center, couplings, layout         <dataset>.json           index.html + metro.js
  treeEdges_*.txt                input_trees/, metadata, …          input_trees/…
```

### 1. Input data — contour trees as text files

Place each dataset under `data/<dataset_name>/`. A contour tree is described by a pair of files:

| File pattern | Contents |
|---|---|
| `treeNodes_*.txt` | One row per node: `x y z height type` (space-separated floats; `type` encodes critical-point kind) |
| `treeEdges_*.txt` | One row per edge: `u v` (0-based node indices) |

The repository includes example datasets (e.g. `HeatedFlow3D_eps3.0`, `HeatedFlowEnsemble_eps3.0`, `VortexStreet_eps1.0`). Code for generating these trees from scalar fields may be added later; for now, provide your own `.txt` pairs in the same format.

Trees are loaded with `lib/read_contour_tree.py`, which builds a NetworkX graph with spatial coordinates, scalar height, and edge weights derived from height differences.

### 2. Barycenter computation — `contourtree_barycenter_FGW.ipynb`

Open and run [`contourtree_barycenter_FGW.ipynb`](contourtree_barycenter_FGW.ipynb) from the repository root. The notebook:

1. Loads a family of contour trees from `data/<dataset_name>/`.
2. Builds relation matrices (adjacency, shortest-path, or heat kernel) for each tree.
3. Runs partial FGW barycenter optimization (via routines in `lib/`).
4. Reconstructs the barycenter graph, computes optimal-transport couplings between each input tree and the barycenter, and lays out trees for visualization.
5. Exports results to `barycenter_export/<dataset_name>/`, including:

   - `G_center.pkl` — barycenter graph  
   - `layout_pos.json` — 2D layout positions  
   - `couplings_direct/` and `couplings_via_graph/` — coupling matrices `T_*.npy`  
   - `input_trees/tree_*.json` — per-input-tree layout and branch structure  
   - `branches.pkl`, `edge_segments.pkl`, `metadata.json`, and related files  

Configure `dataset_name`, simplification level (ε), mass balancing, and solver parameters in the notebook cells before running the export section.

### 3. Data preparation for the viewer — `metro_viz/prepare_data.py`

After each notebook export, convert the `barycenter_export/` bundle into the JSON consumed by the web app:

```bash
cd metro_viz
python prepare_data.py --dataset HeatedFlowEnsemble_eps3.0
```

Common options:

```bash
python prepare_data.py --dataset HeatedFlowEnsemble_eps1.0 --spatial-x 0 127 --spatial-y 0 255
```

On Windows you can also use `run_prepare_data.ps1` or `run_prepare_data.bat` from the `metro_viz` folder.

This writes:

- `metro_viz/data/<dataset>.json` — main dataset bundle for the viewer  
- `metro_viz/data/input_trees/<dataset>/tree_*.json` — per-tree geometry for the side panel  

Re-run `prepare_data.py` whenever the notebook updates `barycenter_export/` (especially after layout or coupling changes).

### 4. Interactive visualization — `metro_viz/`

Serve the `metro_viz` folder with a local HTTP server (required for loading JSON data):

```bash
cd metro_viz
python -m http.server 8080
```

Then open [http://localhost:8080/index.html](http://localhost:8080/index.html) in a browser.

The page loads [`metro.js`](metro_viz/metro.js) (D3-based) and [`style.css`](metro_viz/style.css). The metro-map view shows the barycenter as a schematic “transit map,” with colored lines for input trees, coupling chords encoding transport mass, and panels for inspecting individual input trees and uncertainty (e.g. standard deviation of function values at matched critical points).

## Repository structure

| Path | Role |
|---|---|
| `data/` | Input contour-tree `.txt` files, organized by dataset |
| `contourtree_barycenter_FGW.ipynb` | Main barycenter + export pipeline |
| `lib/` | Core solvers, contour-tree I/O, layout, and visualization utilities (see `lib/README.md` for third-party references) |
| `barycenter_export/` | Notebook output (intermediate; consumed by `prepare_data.py`) |
| `metro_viz/` | Data preparation script, baked JSON, and web viewer (`index.html`, `metro.js`) |
| `debug_export/` | Optional debug bundles from the notebook |

## Dependencies

**Python 3.10+** (3.11 recommended) with:

- [POT](https://pythonot.github.io/) (Python Optimal Transport), [SciPy](https://scipy.org/), [Numba](https://numba.pydata.org/), [scikit-learn](https://scikit-learn.org/), [NetworkX](https://networkx.org/), [Matplotlib](https://matplotlib.org/), and Jupyter

Install via pip:

```bash
pip install -r requirements.txt
```

Or create a Conda environment:

```bash
# Linux / macOS
conda env create -f environment.yml

# Windows
conda env create -f environment.windows.yml
```

The web viewer additionally loads [D3 v7](https://d3js.org/) from a CDN (see `metro_viz/index.html`); no Node.js build step is required.

## Citation

If you use this code, please cite the paper:

> Mingzhe Li, Fangfei Lan, Gunther Weber, Bei Wang. *Uncertainty Visualization for Approximated Barycenter of Contour Trees Based on Partial Optimal Transport.*

(BibTeX and publication details to be added when available.)
