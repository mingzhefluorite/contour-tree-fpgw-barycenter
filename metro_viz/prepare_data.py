"""
Convert barycenter_export data into a single JSON for the D3 metro-map visualization
(Uncertainty Visualization for Approximated Barycenter of Contour Trees Based on Partial Optimal Transport).

Usage:
    python prepare_data.py --dataset HeatedFlowEnsemble_full
    python prepare_data.py --dataset HeatedFlowEnsemble_full --coupling via_graph
    python prepare_data.py --dataset HeatedFlowEnsemble_full --bundle-threshold 0.02  # opt-in merge
    python prepare_data.py --dataset HeatedFlowEnsemble_eps1.0 --spatial-x 0 127 --spatial-y 0 255

Writes:
  metro_viz/data/<dataset>.json
  metro_viz/data/input_trees/<dataset>/tree_*.json  (one folder per dataset / ε)

Re-run this script after every notebook export that updates ``barycenter_export/<dataset>/``
(including ``couplings_*/T_*.npy`` and ``layout_pos.json``). The metro app reads the baked
JSON in ``metro_viz/data/``, not the export folder. If layouts change in the viz but
couplings do not, the export often has fresh ``layout_pos`` with stale ``T_*.npy`` —
fix the notebook save cell (recompute couplings) then run ``prepare_data.py`` again.
"""

import argparse
import json
import math
import os
import pickle
import shutil
import sys
from pathlib import Path

import networkx as nx
import numpy as np

# Compatibility shim: pickle files saved with numpy 2.x reference numpy._core
# which doesn't exist in numpy 1.x.  Patch sys.modules so unpickling works.
import importlib
for _mod_name in ("numpy._core", "numpy._core.multiarray"):
    if _mod_name not in sys.modules:
        try:
            sys.modules[_mod_name] = importlib.import_module(
                _mod_name.replace("numpy._core", "numpy.core")
            )
        except ImportError:
            pass


# ── Color palettes ────────────────────────────────────────────────────
# 23 metro line colors: ColorBrewer-style qualitative (Paired minus orange pair + Dark2 + Set2),
# softer than neon RGB; no pure orange. Slot 2: light sky blue #6abaec; slot 3: burgundy #7a1e48 for CVD contrast.
# Must match metro_viz/metro.js PALETTE_23.
PALETTE_23 = [
    "#1f78b4", "#eaea9a", "#6abaec", "#7a1e48", "#cab2d6",
    "#b15928", "#1b9e77", "#666666", "#8da0cb", "#e7298a",
    "#66a61e", "#8dd3c7", "#fb9a99", "#6a3d9a", "#ccebc5",
    "#66c2a5", "#ffd92f", "#7570b3", "#b2df8a", "#e78ac3",
    "#a6d854", "#e5c494", "#b3b3b3",
]

TAB10 = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
]


# ── Helpers ───────────────────────────────────────────────────────────

def load_graph(export_dir: Path) -> nx.Graph:
    with open(export_dir / "G_center.pkl", "rb") as f:
        return pickle.load(f)


def load_positions(export_dir: Path) -> dict:
    with open(export_dir / "layout_pos.json") as f:
        raw = json.load(f)
    return {int(k): v for k, v in raw.items()}


def load_couplings(export_dir: Path, mode: str, n_inputs: int):
    subdir = export_dir / f"couplings_{mode}"
    couplings = []
    for s in range(n_inputs):
        fpath = subdir / f"T_{s:02d}.npy"
        couplings.append(np.load(str(fpath)))
    return couplings


def load_input_tree(export_dir: Path, s: int) -> dict:
    fpath = export_dir / "input_trees" / f"tree_{s:02d}.json"
    with open(fpath) as f:
        return json.load(f)


def _float_list_or_none(seq):
    if seq is None:
        return None
    try:
        return [float(x) for x in seq]
    except (TypeError, ValueError):
        return None


def _safe_float_or_none(v):
    try:
        if v is None:
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _coord_value(tree_data, node_id, axis):
    """
    Robust coordinate lookup from input tree JSON with multiple schemas:
      - xs/ys/zs dicts
      - x/y/z dicts
      - coords: { "<id>": {"x":..,"y":..,"z":..} }
    """
    sid = str(node_id)
    axis_map_long = tree_data.get(f"{axis}s", {})
    if isinstance(axis_map_long, dict) and sid in axis_map_long:
        return _safe_float_or_none(axis_map_long.get(sid))
    axis_map_short = tree_data.get(axis, {})
    if isinstance(axis_map_short, dict) and sid in axis_map_short:
        return _safe_float_or_none(axis_map_short.get(sid))
    coords = tree_data.get("coords", {})
    if isinstance(coords, dict):
        c = coords.get(sid, {})
        if isinstance(c, dict) and axis in c:
            return _safe_float_or_none(c.get(axis))
    nodes = tree_data.get("nodes")
    if isinstance(nodes, list) and nodes and isinstance(nodes[0], dict):
        for n in nodes:
            if not isinstance(n, dict):
                continue
            nid = n.get("id")
            if str(nid) != sid and nid != node_id:
                continue
            if axis in n:
                return _safe_float_or_none(n.get(axis))
            return None
    return None


def build_coupling_row_mass_lists(
    couplings: list,
    nodes_order_center: list,
    n_inputs: int,
    thresh_frac: float,
) -> dict:
    """
    For each barycenter node (row r of T_s), per input s:
      - if row sum is 0: [[0.0]] for that input;
      - else: list of T_s[r, j] with T_s[r,j] >= thresh_frac * row_sum.
    Used in metro_viz for Shannon entropy (binned) uncertainty.
    """
    order = [int(x) for x in nodes_order_center]
    row_of_id = {order[i]: i for i in range(len(order))}
    out_by_nid = {}
    for nid, r in row_of_id.items():
        per_s = []
        for s in range(n_inputs):
            T = couplings[s]
            row = np.asarray(T[r, :], dtype=float).ravel()
            ssum = float(row.sum())
            if ssum <= 0.0:
                per_s.append([0.0])
            else:
                thr = thresh_frac * ssum
                vals = row[row >= thr]
                per_s.append([float(v) for v in vals.tolist()])
        out_by_nid[nid] = per_s
    return out_by_nid


def compute_unpaired_input_nodes(T: np.ndarray, threshold: float = 0.01) -> set:
    """Return set of input-side column indices with negligible coupling mass."""
    total = float(T.sum())
    n_input = T.shape[1]
    if total <= 0 or n_input == 0:
        return set()
    col_sums = T.sum(axis=0)
    expected = total / n_input
    min_valid = threshold * expected
    return {j for j in range(n_input) if col_sums[j] < min_valid}


def bary_nodes_with_input_correspondence(T_s: np.ndarray, nodes_order_center):
    """
    For each input-tree node there is one coupling column. Its barycenter
    correspondence is the argmax row (primary OT match), including columns
    treated as “unpaired” for stub layout — they still define a match target.

    A barycenter tree edge (u, v) is attributed to this input iff both u and v
    appear here (each is some input node's primary match).
    """
    out = set()
    for j in range(T_s.shape[1]):
        r = int(np.argmax(T_s[:, j]))
        out.add(int(nodes_order_center[r]))
    return out


# ── Node bundling ─────────────────────────────────────────────────────

def compute_bundles(nodes, pos, threshold):
    clusters = {n["id"]: [n["id"]] for n in nodes}
    centroids = {n["id"]: np.array(pos[n["id"]], dtype=float) for n in nodes}

    while True:
        ids = list(clusters.keys())
        if len(ids) < 2:
            break
        best_dist = float("inf")
        best_pair = None
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                d = np.linalg.norm(centroids[ids[i]] - centroids[ids[j]])
                if d < best_dist:
                    best_dist = d
                    best_pair = (ids[i], ids[j])
        if best_dist >= threshold:
            break
        a, b = best_pair
        merged = clusters[a] + clusters[b]
        pts = np.array([pos[nid] for nid in merged])
        new_centroid = pts.mean(axis=0)
        del clusters[b]
        clusters[a] = merged
        centroids[a] = new_centroid
        del centroids[b]

    bundles = []
    for cid, members in clusters.items():
        cx, cy = centroids[cid]
        bundles.append({
            "members": sorted(members),
            "cx": float(cx),
            "cy": float(cy),
        })
    bundles.sort(key=lambda b: b["members"][0])
    return bundles


# ── Branch serialization ─────────────────────────────────────────────

def serialize_branches(branches):
    out = []
    for b in branches:
        out.append({
            "nodes": [int(n) for n in b["nodes"]],
            "parentBranch": int(b["parent_branch"]),
            "mode": b["mode"],
            "depth": int(b["depth"]),
        })
    return out


# ── Unpaired node layout ─────────────────────────────────────────────

def compute_unpaired_layout(unpaired_records, pos, G, effective_pos,
                            stub_length, all_positions):
    """
    Place unpaired nodes with y = height (mandatory) and x offset
    from anchor to minimize overlaps.
    """
    by_anchor = {}
    for rec in unpaired_records:
        a = rec["anchorNode"]
        by_anchor.setdefault(a, []).append(rec)

    # Collect occupied x positions at each y-neighbourhood for overlap avoidance
    occupied = list(all_positions)

    for anchor, recs in by_anchor.items():
        ax, _ = effective_pos.get(anchor, pos.get(anchor, [0.5, 0.5]))

        # Determine preferred offset direction: away from tree neighbors
        neighbor_xs = []
        for nb in G.neighbors(anchor):
            nbx, _ = effective_pos.get(nb, pos.get(nb, [ax, 0]))
            neighbor_xs.append(nbx)

        base_dir = 1  # default: right
        if neighbor_xs:
            avg_nb_x = sum(neighbor_xs) / len(neighbor_xs)
            base_dir = -1 if avg_nb_x > ax else 1

        # Sort by height so nearby nodes get adjacent offsets
        recs.sort(key=lambda r: r["height"])
        for i, rec in enumerate(recs):
            rec["y"] = rec["height"]
            side = base_dir if (i % 2 == 0) else -base_dir
            offset = stub_length * (1 + (i // 2) * 0.5)
            rec["x"] = float(ax + side * offset)
            occupied.append([rec["x"], rec["y"]])


# ── Main ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Prepare metro-map JSON from barycenter export")
    parser.add_argument("--dataset", required=True)
    parser.add_argument("--coupling", default="direct",
                        choices=["direct", "via_graph"])
    parser.add_argument("--threshold", type=float, default=0.01,
                        help="Match threshold")
    parser.add_argument("--bundle-threshold", type=float, default=None,
                        help="Merge node pairs closer than this (layout units); "
                             "default 0 disables bundling (metro_viz uses y-separation instead)")
    parser.add_argument("--stub-length", type=float, default=None,
                        help="Stub length for unpaired nodes "
                             "(default: 0.04 * layout extent)")
    parser.add_argument("--export-root", default=None)
    parser.add_argument(
        "--spatial-x", type=float, nargs=2, metavar=("MIN", "MAX"),
        default=None,
        help="Optional original field domain x-range for metro coord plot (with --spatial-y)",
    )
    parser.add_argument(
        "--spatial-y", type=float, nargs=2, metavar=("MIN", "MAX"),
        default=None,
        help="Optional original field domain y-range for metro coord plot (with --spatial-x)",
    )
    parser.add_argument(
        "--prob-unc-threshold", type=float, default=0.1,
        dest="prob_unc_threshold",
        help="Coupling mass cutoff as fraction of row sum for probabilistic uncertainty",
    )
    parser.add_argument(
        "--prob-unc-bins", type=int, default=5, dest="prob_unc_bins",
        help="Number of equal-width bins for Shannon entropy in metro_viz",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    export_root = (Path(args.export_root) if args.export_root
                   else script_dir.parent / "barycenter_export")
    export_dir = export_root / args.dataset

    if not export_dir.exists():
        print(f"Error: export directory not found: {export_dir}",
              file=sys.stderr)
        sys.exit(1)

    with open(export_dir / "metadata.json") as f:
        meta = json.load(f)
    n_inputs = meta["n_inputs"]
    n_center = meta["N_center"]

    G = load_graph(export_dir)
    pos = load_positions(export_dir)
    with open(export_dir / "branches.pkl", "rb") as f:
        branches = pickle.load(f)

    couplings = load_couplings(export_dir, args.coupling, n_inputs)

    # Node orderings (row/col index → node id)
    with open(export_dir / "nodes_order_center.json") as f:
        nodes_order_center = json.load(f)
    with open(export_dir / "nodes_list.json") as f:
        nodes_list = json.load(f)

    # ── Node colors ───────────────────────────────────────────────────
    node_color_map = {}
    for i, nid in enumerate(nodes_order_center):
        node_color_map[nid] = TAB10[i % len(TAB10)]

    type_class_order = meta.get("unique_types")
    if type_class_order is not None:
        type_class_order = [int(x) for x in type_class_order]

    coupling_mass_by_nid = build_coupling_row_mass_lists(
        couplings,
        nodes_order_center,
        n_inputs,
        args.prob_unc_threshold,
    )
    default_mass_per_input = [[0.0] for _ in range(n_inputs)]

    nodes_out = []
    for n in sorted(G.nodes()):
        attrs = G.nodes[n]
        p = pos.get(n, [0, 0])
        node_entry = {
            "id": int(n),
            "x": float(p[0]),
            "y": float(p[1]),
            "height": float(attrs.get("height", 0)),
            "type": int(attrs.get("type", 1)),
            "color": node_color_map.get(n, "#808080"),
        }
        tf = _float_list_or_none(attrs.get("type_features"))
        if tf:
            node_entry["typeFeatures"] = tf
        tm = _float_list_or_none(attrs.get("type_mass"))
        if tm:
            node_entry["typeMass"] = tm
        node_entry["couplingRowMasses"] = coupling_mass_by_nid.get(
            int(n), default_mass_per_input)
        nodes_out.append(node_entry)

    # ── Edges ─────────────────────────────────────────────────────────
    edge_key_to_idx = {}
    edges_out = []
    for u, v in G.edges():
        key = (min(u, v), max(u, v))
        if key not in edge_key_to_idx:
            idx = len(edges_out)
            edge_key_to_idx[key] = idx
            edges_out.append({
                "source": int(key[0]),
                "target": int(key[1]),
                "weight": float(G.edges[u, v].get("weight", 0)),
                "lines": [],
            })

    # ── Lines ─────────────────────────────────────────────────────────
    lines_out = []
    # Per input s: input tree node id (str) -> primary matched barycenter node id (argmax column).
    input_primary_bary = []
    # matched_sets[s] = bary nodes with ≥1 paired-column correspondence
    matched_sets = []
    # node_match_index[bary_node_id]["byInput"][s] -> list of matched source records
    node_match_index = {
        int(nid): {"byInput": {}, "inputs": []}
        for nid in nodes_order_center
    }
    for s in range(n_inputs):
        T_s = couplings[s]
        unpaired_cols = compute_unpaired_input_nodes(
            T_s, threshold=args.threshold)
        with_corr = bary_nodes_with_input_correspondence(
            T_s, nodes_order_center)
        matched_sets.append(with_corr)

        route_edge_indices = []
        for u, v in G.edges():
            u = int(u)
            v = int(v)
            if u in with_corr and v in with_corr:
                key = (min(u, v), max(u, v))
                eidx = edge_key_to_idx.get(key)
                if eidx is not None:
                    route_edge_indices.append(eidx)
                    edges_out[eidx]["lines"].append(s)
        lines_out.append({
            "id": s,
            "name": f"Input {s}",
            "color": PALETTE_23[s % len(PALETTE_23)],
            "matchedNodes": sorted(with_corr),
            "routeEdges": sorted(route_edge_indices),
        })

        # Build per-bary-node matched source-node records for panel stats.
        nl_s = nodes_list[s]
        tree_data_s = load_input_tree(export_dir, s)
        heights_s = tree_data_s.get("heights", {})
        types_s = tree_data_s.get("types", {})
        for j in range(T_s.shape[1]):
            if j in unpaired_cols:
                continue
            src_node_id = int(nl_s[j])
            col = T_s[:, j]
            best_row = int(np.argmax(col))
            bary_node_id = int(nodes_order_center[best_row])
            rec = {
                "inputIdx": int(s),
                "inputNodeId": src_node_id,
                "height": _safe_float_or_none(
                    heights_s.get(str(src_node_id), 0.0)),
                "type": int(types_s.get(str(src_node_id), 1)),
                "coord": {
                    "x": _coord_value(tree_data_s, src_node_id, "x"),
                    "y": _coord_value(tree_data_s, src_node_id, "y"),
                    "z": _coord_value(tree_data_s, src_node_id, "z"),
                },
                "mass": float(col[best_row]),
            }
            by_input = node_match_index[bary_node_id]["byInput"]
            by_input.setdefault(str(s), []).append(rec)

        m_primary = {}
        for j in range(T_s.shape[1]):
            sid = int(nl_s[j])
            r = int(np.argmax(T_s[:, j]))
            m_primary[str(sid)] = int(nodes_order_center[r])
        input_primary_bary.append(m_primary)

    # mediatedLines will be computed after unpaired nodes are processed

    # ── numLines per node ─────────────────────────────────────────────
    node_lines = {n["id"]: set() for n in nodes_out}
    for e in edges_out:
        for lid in e["lines"]:
            node_lines[e["source"]].add(lid)
            node_lines[e["target"]].add(lid)
    for n in nodes_out:
        n["numLines"] = len(node_lines[n["id"]])

    # ── Branches ──────────────────────────────────────────────────────
    branches_out = serialize_branches(branches)

    edge_branch_info = {}
    for bidx, branch in enumerate(branches):
        bnodes = branch["nodes"]
        for i in range(len(bnodes) - 1):
            u, v = bnodes[i], bnodes[i + 1]
            key = (min(u, v), max(u, v))
            eidx = edge_key_to_idx.get(key)
            if eidx is not None:
                edge_branch_info[eidx] = {
                    "branch": bidx,
                    "posInBranch": i,
                }
    for eidx, e in enumerate(edges_out):
        info = edge_branch_info.get(eidx,
                                    {"branch": -1, "posInBranch": -1})
        e["branch"] = info["branch"]
        e["posInBranch"] = info["posInBranch"]

    # ── Node bundling ─────────────────────────────────────────────────
    # Default off: proximity bundling used to declutter; metro.js now separates close y-values.
    xs = [n["x"] for n in nodes_out]
    ys = [n["y"] for n in nodes_out]
    x_range = max(xs) - min(xs) if xs else 1
    y_range = max(ys) - min(ys) if ys else 1
    layout_extent = max(x_range, y_range)
    bundle_threshold = (args.bundle_threshold if args.bundle_threshold
                        is not None else 0.0)

    bundles_raw = compute_bundles(nodes_out, pos, bundle_threshold)

    node_to_bundle = {}
    for bidx, b in enumerate(bundles_raw):
        for nid in b["members"]:
            node_to_bundle[nid] = bidx

    node_by_id = {n["id"]: n for n in nodes_out}
    bundles_out = []
    for bidx, b in enumerate(bundles_raw):
        members_info = []
        for nid in b["members"]:
            n = node_by_id[nid]
            mem = {
                "id": nid,
                "color": n["color"],
                "height": n["height"],
                "type": n["type"],
                "numLines": n["numLines"],
            }
            if "typeFeatures" in n:
                mem["typeFeatures"] = n["typeFeatures"]
            if "typeMass" in n:
                mem["typeMass"] = n["typeMass"]
            members_info.append(mem)
        bundles_out.append({
            "id": bidx,
            "members": members_info,
            "cx": b["cx"],
            "cy": b["cy"],
        })

    for n in nodes_out:
        n["bundle"] = node_to_bundle[n["id"]]

    for e in edges_out:
        sb = node_to_bundle.get(e["source"], -1)
        tb = node_to_bundle.get(e["target"], -1)
        e["internalToBundle"] = (sb == tb and sb >= 0)

    # Legacy field: metro.js uses per-edge ``specialChordLines`` instead.
    cross_bary_edges_out = []

    # Effective positions (accounting for bundles)
    effective_pos = {}
    for n in nodes_out:
        bndl = bundles_raw[node_to_bundle[n["id"]]]
        if len(bndl["members"]) > 1:
            effective_pos[n["id"]] = [bndl["cx"], bndl["cy"]]
        else:
            effective_pos[n["id"]] = pos[n["id"]]

    # ── Unpaired input nodes ──────────────────────────────────────────
    input_trees_dir = export_dir / "input_trees"
    has_input_trees = input_trees_dir.exists()

    unpaired_out = []
    stub_edges_out = []

    if has_input_trees:
        stub_length = (args.stub_length if args.stub_length is not None
                       else 0.04 * layout_extent)

        # Build index: input node ID → column index for each input
        # nodes_list[s] maps column j → input node ID
        # We need the reverse: input node ID → column j
        all_unpaired_records = []

        for s in range(n_inputs):
            T_s = couplings[s]
            nl_s = nodes_list[s]
            input_node_to_col = {nid: j for j, nid in enumerate(nl_s)}

            # Load input tree edges
            tree_data = load_input_tree(export_dir, s)
            input_edges = tree_data["edges"]
            input_heights = tree_data["heights"]
            input_types = tree_data["types"]

            # Build adjacency for the input tree
            input_adj = {}
            for u, v in input_edges:
                input_adj.setdefault(u, set()).add(v)
                input_adj.setdefault(v, set()).add(u)

            # Unpaired columns (input nodes with low coupling mass)
            unpaired_cols = compute_unpaired_input_nodes(
                T_s, threshold=args.threshold)
            unpaired_input_ids = {nl_s[j] for j in unpaired_cols}

            # Paired columns
            paired_col_set = set(range(T_s.shape[1])) - unpaired_cols

            # For each unpaired input node, find paired neighbors
            for j in unpaired_cols:
                u_id = nl_s[j]
                neighbors = input_adj.get(u_id, set())
                paired_neighbors = []
                for nb in neighbors:
                    nb_col = input_node_to_col.get(nb)
                    if nb_col is not None and nb_col in paired_col_set:
                        # Find which barycenter node this pairs to
                        col_coupling = T_s[:, nb_col]
                        best_row = int(np.argmax(col_coupling))
                        bary_node = nodes_order_center[best_row]
                        strength = float(col_coupling[best_row])
                        paired_neighbors.append(
                            (bary_node, strength, nb))

                if not paired_neighbors:
                    continue

                # Pick the anchor with strongest coupling
                paired_neighbors.sort(key=lambda x: -x[1])
                anchor_bary = paired_neighbors[0][0]

                uid = f"s{s}_n{u_id}"
                h = float(input_heights.get(str(u_id), 0))
                t = int(input_types.get(str(u_id), 1))

                rec = {
                    "id": uid,
                    "inputIdx": s,
                    "inputNodeId": u_id,
                    "anchorNode": anchor_bary,
                    "height": h,
                    "type": t,
                    "x": 0.0,
                    "y": 0.0,
                }
                all_unpaired_records.append(rec)

                # Stub edges: one per paired neighbor connection
                for bary_node, strength, nb_input in paired_neighbors:
                    stub_edges_out.append({
                        "unpairedId": uid,
                        "anchorNode": bary_node,
                        "inputIdx": s,
                    })

        # Compute layout positions for all unpaired nodes
        all_positions = [effective_pos[nid] for nid in effective_pos]
        compute_unpaired_layout(
            all_unpaired_records, pos, G, effective_pos, stub_length,
            all_positions)

        unpaired_out = all_unpaired_records

        # ── Compute mediatedLines per edge ────────────────────────
        # An edge is "mediated" for an input if an unpaired node from
        # that input has stub edges to both endpoints (or to nodes on
        # the path between endpoints). These edges are artificial —
        # the real connection goes through the unpaired node.
        from collections import defaultdict
        unpaired_anchor_map = defaultdict(
            lambda: {"inputIdx": None, "anchors": set()})
        for se in stub_edges_out:
            uid = se["unpairedId"]
            unpaired_anchor_map[uid]["inputIdx"] = se["inputIdx"]
            unpaired_anchor_map[uid]["anchors"].add(se["anchorNode"])

        mediated_by_input = defaultdict(set)
        for uid, info in unpaired_anchor_map.items():
            input_idx = info["inputIdx"]
            anchors = sorted(info["anchors"])
            if len(anchors) < 2:
                continue
            for i in range(len(anchors)):
                for j in range(i + 1, len(anchors)):
                    try:
                        path = nx.shortest_path(
                            G, anchors[i], anchors[j])
                    except nx.NetworkXNoPath:
                        continue
                    for k in range(len(path) - 1):
                        u, v = path[k], path[k + 1]
                        key = (min(u, v), max(u, v))
                        eidx = edge_key_to_idx.get(key)
                        if eidx is not None:
                            mediated_by_input[input_idx].add(eidx)

        for eidx, e in enumerate(edges_out):
            ml = sorted(s for s, eset in mediated_by_input.items()
                        if eidx in eset)
            # Metro UI hides stripes for mediated lines only. If this edge is
            # already a direct barycenter edge for input s (both endpoints have
            # primary matches), do not treat s as mediated on this edge.
            direct = set(e["lines"])
            ml = [s for s in ml if s not in direct]
            e["mediatedLines"] = ml

        n_med = sum(1 for e in edges_out if e["mediatedLines"])
        print(f"Unpaired nodes: {len(unpaired_out)} "
              f"(across {n_inputs} inputs)")
        print(f"Stub edges: {len(stub_edges_out)}")
        print(f"Edges with mediated lines: {n_med}")
    else:
        print("No input_trees/ directory found – skipping unpaired nodes")
        for e in edges_out:
            e["mediatedLines"] = []

    # ── specialChordLines: Steiner edges on bary paths for critical input-tree links ──
    # For each input line s, metro subgraph = Steiner edges carrying s (non-mediated).
    # If an input-tree edge joins two paired nodes whose bary images lie in different
    # UF components, mark every Steiner edge on the shortest bary path between those
    # images with line s (metro draws one bundle; strikes on s for those edges).
    from collections import defaultdict as _dd_spec_edges
    for e in edges_out:
        e["specialChordLines"] = []
    it_dir_spec = export_dir / "input_trees"
    if it_dir_spec.is_dir():
        spec_by_eidx = _dd_spec_edges(set)
        for s in range(n_inputs):
            T_s = couplings[s]
            nl_s = nodes_list[s]
            input_node_to_col = {int(nid): j for j, nid in enumerate(nl_s)}
            unpaired_cols = compute_unpaired_input_nodes(
                T_s, threshold=args.threshold)
            paired_col_set = set(range(T_s.shape[1])) - unpaired_cols
            m_primary = input_primary_bary[s]
            V_s = set(lines_out[s]["matchedNodes"])
            if not V_s:
                continue
            parent = {n: n for n in V_s}

            def _uf_find(x):
                while parent[x] != x:
                    parent[x] = parent[parent[x]]
                    x = parent[x]
                return x

            def _uf_union(a, b):
                ra, rb = _uf_find(a), _uf_find(b)
                if ra != rb:
                    parent[rb] = ra

            for eidx, e in enumerate(edges_out):
                if s not in e["lines"]:
                    continue
                if s in e.get("mediatedLines", []):
                    continue
                u, v = int(e["source"]), int(e["target"])
                if u in V_s and v in V_s:
                    _uf_union(u, v)

            tree_data = load_input_tree(export_dir, s)
            for uv in tree_data.get("edges") or []:
                if not isinstance(uv, (list, tuple)) or len(uv) != 2:
                    continue
                try:
                    u_id = int(uv[0])
                    v_id = int(uv[1])
                except (TypeError, ValueError):
                    continue
                if u_id == v_id:
                    continue
                ju = input_node_to_col.get(u_id)
                jv = input_node_to_col.get(v_id)
                if ju is None or jv is None:
                    continue
                if ju not in paired_col_set or jv not in paired_col_set:
                    continue
                au = m_primary.get(str(u_id))
                av = m_primary.get(str(v_id))
                if au is None or av is None:
                    continue
                au = int(au)
                av = int(av)
                if au == av or au not in V_s or av not in V_s:
                    continue
                if _uf_find(au) == _uf_find(av):
                    continue
                try:
                    path_nodes = nx.shortest_path(G, au, av)
                except (nx.NetworkXNoPath, nx.NodeNotFound):
                    continue
                for i in range(len(path_nodes) - 1):
                    a, b = path_nodes[i], path_nodes[i + 1]
                    key = (min(a, b), max(a, b))
                    ei = edge_key_to_idx.get(key)
                    if ei is not None:
                        spec_by_eidx[ei].add(s)
        for eidx, lid_set in spec_by_eidx.items():
            edges_out[eidx]["specialChordLines"] = sorted(lid_set)

    # Add unpaired node counts per line
    for line in lines_out:
        line["unpairedNodes"] = [
            rec["id"] for rec in unpaired_out
            if rec["inputIdx"] == line["id"]
        ]

    # Finalize node_match_index inputs list
    for nid in node_match_index:
        keys = node_match_index[nid]["byInput"].keys()
        node_match_index[nid]["inputs"] = sorted(int(k) for k in keys)

    # ── Assemble output ───────────────────────────────────────────────
    # Soft type masses/features are read from G_center.pkl onto each node below.
    # Export-side metadata.json only needs unique_types (as typeClassOrder) to
    # interpret those vectors — avoid duplicating N×K soft matrices in metadata.json
    # (single source of truth: the pickled graph; metro JSON gets a copy via this script).
    meta_out = {
        "dataset": args.dataset,
        "coupling": args.coupling,
        "nInputs": n_inputs,
        "nCenter": n_center,
        "threshold": args.threshold,
        "bundleThreshold": bundle_threshold,
    }
    if type_class_order is not None:
        meta_out["typeClassOrder"] = type_class_order
    if args.spatial_x is not None and args.spatial_y is not None:
        meta_out["spatialDomain"] = {
            "x": [float(args.spatial_x[0]), float(args.spatial_x[1])],
            "y": [float(args.spatial_y[0]), float(args.spatial_y[1])],
        }
    meta_out["probUncertainty"] = {
        "massThresholdFrac": float(args.prob_unc_threshold),
        "entropyBins": int(args.prob_unc_bins),
    }

    output = {
        "meta": meta_out,
        "nodes": nodes_out,
        "edges": edges_out,
        "crossBaryEdges": cross_bary_edges_out,
        "lines": lines_out,
        "branches": branches_out,
        "bundles": bundles_out,
        "unpairedNodes": unpaired_out,
        "stubEdges": stub_edges_out,
        "nodeMatchIndex": node_match_index,
        "nodesOrderCenter": [int(x) for x in nodes_order_center],
        "inputPrimaryBarycenter": input_primary_bary,
    }

    out_dir = script_dir / "data"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / f"{args.dataset}.json"
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    # One folder per dataset stem so ε / parameter variants do not overwrite each other.
    it_src = export_dir / "input_trees"
    if it_src.is_dir():
        it_dst = out_dir / "input_trees" / args.dataset
        it_dst.mkdir(parents=True, exist_ok=True)
        for p in sorted(it_src.glob("tree_*.json")):
            shutil.copy2(p, it_dst / p.name)
        n_trees = len(list(it_dst.glob("tree_*.json")))
        print(f"Copied {n_trees} file(s) to {it_dst}/")

    # Summary
    n_singleton = sum(1 for b in bundles_out if len(b["members"]) == 1)
    n_multi = len(bundles_out) - n_singleton
    total_route = sum(len(l["routeEdges"]) for l in lines_out)
    max_mult = max((len(e["lines"]) for e in edges_out), default=0)
    print(f"Dataset: {args.dataset}")
    print(f"Coupling: {args.coupling}")
    print(f"Nodes: {len(nodes_out)}, Edges: {len(edges_out)}")
    print(f"Lines: {len(lines_out)}, Total route edges: {total_route}")
    print(f"Max edge multiplicity: {max_mult}")
    n_spec_e = sum(1 for e in edges_out if e.get("specialChordLines"))
    n_spec_m = sum(len(e.get("specialChordLines", [])) for e in edges_out)
    print(f"Steiner edges with specialChordLines (strike stripes): {n_spec_e} "
          f"(line-edge marks: {n_spec_m}); legacy crossBaryEdges list: "
          f"{len(cross_bary_edges_out)}")
    print(f"Bundles: {len(bundles_out)} "
          f"({n_singleton} singleton, {n_multi} multi-node)")
    print(f"Bundle threshold: {bundle_threshold:.4f}")
    print(f"Written to: {out_path}")

    write_data_manifest(out_dir)


def write_data_manifest(data_dir: Path) -> None:
    """
    Scan data_dir for *.json (except manifest.json) and write data/manifest.json
    so the web UI can list all available datasets and distribution variants
    (e.g. {name}_eps{p}.json, {name}_eps{p}_balanced_distribution.json).
    """
    def _parse_stem(stem: str):
        balanced_suffix = "_balanced_distribution"
        is_balanced = stem.endswith(balanced_suffix)
        core = stem[:-len(balanced_suffix)] if is_balanced else stem
        marker = "_eps"
        i = core.rfind(marker)
        if i < 0:
            return {
                "stem": stem,
                "base": core,
                "eps": None,
                "distribution": "balanced" if is_balanced else "unbalanced",
            }
        return {
            "stem": stem,
            "base": core[:i],
            "eps": core[i + len(marker):],
            "distribution": "balanced" if is_balanced else "unbalanced",
        }

    stems = []
    parsed = []
    for p in sorted(data_dir.glob("*.json")):
        if p.name == "manifest.json":
            continue
        stems.append(p.stem)
        parsed.append(_parse_stem(p.stem))
    stems.sort()
    parsed.sort(key=lambda x: x["stem"])
    manifest = {
        "datasets": stems,          # backward-compatible flat stem list
        "datasetRecords": parsed,   # structured records for dataset/eps/distribution selectors
    }
    manifest_path = data_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"Manifest: {len(stems)} dataset(s) -> {manifest_path}")


if __name__ == "__main__":
    main()
