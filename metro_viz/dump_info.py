import json, sys, pickle
sys.modules.setdefault("numpy._core", __import__("numpy").core)
sys.modules.setdefault("numpy._core.multiarray", __import__("numpy.core.multiarray"))
import numpy as np, networkx as nx

d = json.load(open("data/HeatedFlowEnsemble_full.json"))
print("=== NODES ===")
for n in d["nodes"]:
    tname = {0:"min",1:"saddle",2:"max"}.get(n["type"],"?")
    print("  %2d  x=%.4f  y=%.6f  h=%.6f  %s" % (n["id"],n["x"],n["y"],n["height"],tname))
print()
print("=== EDGES ===")
for e in d["edges"]:
    print("  %2d -- %2d  w=%.6f  lines=%d" % (e["source"],e["target"],e["weight"],len(e["lines"])))

print()
print("=== GRAPH STRUCTURE (adjacency) ===")
G = pickle.load(open("../barycenter_export/HeatedFlowEnsemble_full/G_center.pkl","rb"))
for n in sorted(G.nodes()):
    nbs = sorted(G.neighbors(n))
    t = G.nodes[n].get("type","?")
    tname = {0:"min",1:"saddle",2:"max"}.get(t,"?")
    print("  %2d (%s, deg=%d): neighbors=%s" % (n, tname, G.degree(n), nbs))

print()
print("=== BRANCH DECOMPOSITION ===")
branches = pickle.load(open("../barycenter_export/HeatedFlowEnsemble_full/branches.pkl","rb"))
for i, b in enumerate(branches):
    path_str = "-".join(str(x) for x in b["nodes"])
    parent = b["parent_branch"]
    mode = b["mode"]
    print("  [%d] parent=%d mode=%s: %s" % (i, parent, mode, path_str))
