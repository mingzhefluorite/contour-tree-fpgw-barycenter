// metro.js – D3 metro-map uncertainty visualization for approximated contour-tree barycenters
// (Uncertainty Visualization for Approximated Barycenter of Contour Trees Based on Partial Optimal Transport)
(function () {
  "use strict";

  // Captured synchronously while this script executes (document.currentScript is null later).
  const __METRO_SCRIPT_DIR__ = (function resolveScriptDir() {
    try {
      const cur = document.currentScript;
      if (cur && cur.src) return new URL(".", cur.src).href;
    } catch (e) { /* ignore */ }
    const scripts = document.getElementsByTagName("script");
    for (let i = scripts.length - 1; i >= 0; i--) {
      const s = scripts[i];
      const src = s.getAttribute("src");
      if (!src) continue;
      if (/metro\.js(\?|#|$)/i.test(src)) {
        try {
          return new URL(".", s.src).href;
        } catch (e) {
          break;
        }
      }
    }
    try {
      return new URL(".", window.location.href).href;
    } catch (e) {
      return "";
    }
  })();

  const CONFIG = {
    margin: { top: 40, right: 40, bottom: 40, left: 40 },
    minEdgeWidth: 1.5,
    maxEdgeWidth: 14,
    edgeWidthPower: 2.0,
    edgeColor: "#bbb",
    edgeHighlightBoost: 2,
    edgeDimOpacity: 0.15,
    /**
     * Cross-bary chords (metro only): strike spacing/length vs stripe width; caps keep
     * ticks shorter than the stripe when many lines stack in parallel.
     */
    crossBaryStrikeSpacingFactor: 1.2,
    crossBaryStrikeLengthFactor: 0.3,
    /** Max tick half-span as fraction of stripe width and absolute px cap. */
    crossBaryStrikeMaxSpanFrac: 0.34,
    crossBaryStrikeMaxPx: 4.5,
    crossBaryStrikeStroke: "rgba(0,0,0,0.42)",
    crossBaryStrikeWidth: 1.1,
    /** Soft spine under the solid stripe (metro line color). */
    crossBaryUnderlayOpacity: 0.18,
    crossBaryUnderlayWidthFactor: 1.28,
    nodeRadiusBase: 14,
    nodeRadiusPerMember: 3,
    unpairedRadiusFactor: 0.6,
    unpairedStrokeWidth: 1,
    stubEdgeWidth: 1.5,
    stubEdgeDash: "4,3",
    stationStrokeWidth: 1.5,
    /**
     * Horizontal stretch vs vertical (data units → px): scaleX = scaleY × this.
     * Fits plot; does not mutate JSON. 1 = uniform scaling (legacy behavior).
     */
    layoutScaleX: 1.4,
    labelFontSize: 10,
    unpairedLabelFontSize: 7,
    /** All selected inputs share this edge: aggregate stroke (orange). Width = fraction × station diameter. */
    metroAllSharedColor: "#f97316",
    metroAllSharedWidthFraction: 0.80,
    /** Use aggregate stroke only when at least this many inputs are selected (below: per-line stripes). */
    metroAllSharedMinSelectedInputs: 5,
    /**
     * When false, unpaired nodes and stub edges are not drawn on the barycenter map.
     * Use the side input-tree panel instead (single selection, multi off).
     */
    showUnpairedOverlayOnBarycenter: false,
    /**
     * Spread nodes vertically when function values (heights) are very close: cumulative
     * offset so rendered gap ≥ ~one station radius in data units (see applyYAxisSeparation*).
     */
    yAxisSeparationEnabled: true,
    /**
     * [Deprecated compatibility fallback] Shared epsilon scale factor used by both
     * barycenter and input-tree y-axis separation when specific factors are unset.
     */
    yAxisSeparationEpsPxFactor: 1.0,
    /** Barycenter-only epsilon scale factor for y-axis separation (px -> data eps). */
    yAxisSeparationBaryEpsPxFactor: 3.0,
    /** Input-tree-only epsilon scale factor for y-axis separation (px -> data eps). */
    yAxisSeparationInputTreeEpsPxFactor: 2.0,
    /** Horizontal padding (fraction of distinct-x span) for even-x layout left/right. */
    evenXPaddingFraction: 0.04,
    /**
     * When true, logs `distinct`, `targets`, per-node/unpaired x, bundle median column
     * and cx (filter DevTools by "[even-x]"). Uses console.log for default log level.
     */
    debugEvenXLayout: false,
    /**
     * When `debugEvenXLayout` is true, logs one extra "[even-x] focus nodes …" row for
     * these contour node ids (e.g. [24, 25, 26, 27]). Empty array skips that row.
     */
    debugEvenXFocusNodeIds: [24, 25, 26, 27],
    /**
     * Sequential colormap for **function variation** (height std) on barycenter stations.
     * Std values are mapped linearly to [0, 1] (relative to max std in the current view),
     * then interpolated along this list.
     */
    stdVariationColors: [
      "#444762",
      "#2E687D",
      "#0B8985",
      "#3EA678",
      "#86BF60",
      "#D9CF4F"
    ],
    /**
     * Sequential colormap for **coupling (probabilistic)** uncertainty: Shannon H of
     * binned coupling masses. Used when {@link CONFIG.baryNodeUncertaintyMode} is
     * `"probabilistic"` (same encoding path as std σ, different palette).
     */
    couplingUncertaintyColors: [
      "#AF575D",
      "#BB6888",
      "#B581B3",
      "#99A0D7",
      "#69BFEA",
      "#2BDBE8"
    ],
    /** Disk / wedge base fill when function-variation color is drawn inside the coord ellipse. */
    baryStationNeutralDiskFill: "#e9ecef",
    /**
     * Barycenter node encoding when not in single-input vs bary compare mode:
     * "functionVariation" — σ of matched heights → sequential colors inside coord ellipse;
     * "probabilistic" — Shannon entropy of binned coupling masses (same ellipse + fill encoding).
     */
    baryNodeUncertaintyMode: "functionVariation",
    /**
     * When the node-details panel is open and not in single-input categorical compare mode,
     * neutral gray tint inside the station radius, under the coord-uncertainty ellipse (when
     * present). Gray avoids shifting hues inside the ellipse vs the un-highlighted disk.
     * Radius = station outline radius × this scale (≤ 1 keeps the glyph inside the circle).
     */
    mapStationDetailHighlightRadiusScale: 0.94,
    mapStationDetailHighlightStroke: "#868e96",
    mapStationDetailHighlightFill: "rgba(108, 117, 125, 0.2)",
    mapStationDetailHighlightStrokeWidth: 2,
    /**
     * Input tree: opacity for nodes (and incident edges) with no bary coupling or in
     * `data.unpairedNodes` — lower = more de-emphasized vs matched nodes.
     */
    inputTreeDimmedElementOpacity: 0.5,
    /** Inner ellipse for matched (x,y) spread in field space (see computeAllCoordUncertainties). */
    coordUncertaintyEllipsoidEnabled: true,
    /** Semi-axis length in px as fraction of station radius when spread / max is 0. */
    coordUncertaintyAxisMinFrac: 0.5,
    /** Semi-axis length in px as fraction of station radius when spread / max is 1. */
    coordUncertaintyAxisMaxFrac: 0.95,
  };

  // ── State ────────────────────────────────────────────────────────
  let data = null;
  let svgGroup = null;
  let xScale, yScale;
  let highlightedLine = null;

  let selectedLines = new Set();
  let multiSelect = false;
  let edgeMode = "bundled"; // "bundled" | "metro"
  /** Evenly space distinct layout x-columns across the plot (barycenter map). */
  let evenXDistribution = true;
  /** Hide bary nodes that have no substantial coupling match in any input. */
  let hideZeroSubstantialNodes = false;

  const LS_NODE_COLOR_SCHEME = "metroNodeColorScheme";
  /** localStorage JSON: { [datasetStem]: { [nodeId]: "#rrggbb" } } */
  const LS_NODE_OVERRIDES = "metroNodeColorOverridesV1";
  /** localStorage JSON: { [datasetStem]: { [lineId]: "#rrggbb" } } */
  const LS_LINE_OVERRIDES = "metroLineColorOverridesV1";
  const LS_BARY_UNCERTAINTY_MODE = "metroBaryUncertaintyModeV1";
  const LS_HIDE_ZERO_SUBSTANTIAL_NODES = "metroHideZeroSubstantialNodesV1";
  const LS_LAYOUT_SCALE_X = "metroLayoutScaleXV1";
  /** Barycenter default palette: "file" (JSON) | "categorical" (discrete cycling colors). */
  let nodeColorScheme = "file";
  let _nodeColorOverrideBlob = null;
  /** Per-node hex overrides for the current dataset stem (applied on top of defaults). */
  let _nodeColorOverrides = new Map();
  let _lineColorOverrideBlob = null;
  /** Per-input-line hex overrides for the current dataset stem (metro stripes, legend, etc.). */
  let _lineColorOverrides = new Map();
  /** Latest barycenter node id -> display fill (for input-tree color transfer). */
  let _baryDisplayColorById = new Map();

  /** Last fetched input tree for redraw after panel layout / resize. */
  let _lastInputTreePayload = null;
  let _inputTreeResizeObserver = null;

  // Cached references
  let _edgeLineSet = null;
  let _edgeMediatedLineSet = null;
  /** Per Steiner edge: input lines that need strike stripes (``specialChordLines`` from JSON). */
  let _edgeSpecialChordLineSet = null;
  let _edgeFullRoutePop = null; // number of unmediated lines per edge with all inputs selected
  let _globalMaxRoutePopFull = 1;
  let _gEdges = null;
  let _gStations = null;
  let _gUnpaired = null;
  let _nodeById = null;
  let _bundleById = null;
  let _effectivePos = null;
  let _selectedDetailNodeId = null;
  let _bundleCandidateIds = [];
  /** Bary node ids with >=1 substantial coupling mass over all inputs. */
  let _substantialMatchNodeIds = new Set();
  /** User-tunable horizontal scale factor for barycenter map rendering. */
  let layoutScaleXUser = Number.isFinite(CONFIG.layoutScaleX) && CONFIG.layoutScaleX > 0
    ? CONFIG.layoutScaleX
    : 1;

  // ── Data Loading ─────────────────────────────────────────────────

  /**
   * Directory containing metro.js (trailing slash). Cached at parse time so it
   * stays valid after DOMContentLoaded (document.currentScript is null then).
   */
  function getMetroScriptBase() {
    if (__METRO_SCRIPT_DIR__) return __METRO_SCRIPT_DIR__;
    try {
      return new URL(".", window.location.href).href;
    } catch (e) {
      return "";
    }
  }

  /** Directory URL for the current page (so data/ sits next to index.html). */
  function pageAsDirectoryHref() {
    try {
      const u = new URL(window.location.href);
      let p = u.pathname;
      if (!p.endsWith("/")) {
        const last = p.slice(p.lastIndexOf("/") + 1);
        if (last.includes(".")) {
          p = p.replace(/\/[^/]*$/, "/");
        } else {
          p += "/";
        }
      }
      u.pathname = p;
      return u.href;
    } catch (e) {
      return window.location.href;
    }
  }

  function dataUrl(path) {
    const base = getMetroScriptBase();
    if (typeof window.__METRO_DATA_BASE__ === "string" && window.__METRO_DATA_BASE__.length) {
      try {
        return new URL(path, window.__METRO_DATA_BASE__).href;
      } catch (e) { /* fall through */ }
    }
    return new URL(path, base).href;
  }

  /** Ordered list of base URLs to try for data/*.json and manifest. */
  function dataBaseCandidates() {
    const list = [];
    const push = (href) => {
      if (href && !list.includes(href)) list.push(href);
    };
    if (typeof window.__METRO_DATA_BASE__ === "string" && window.__METRO_DATA_BASE__.length) {
      try {
        push(new URL(".", window.__METRO_DATA_BASE__).href);
      } catch (e) { /* ignore */ }
    }
    push(getMetroScriptBase());
    push(pageAsDirectoryHref());
    try {
      push(new URL(".", window.location.href).href);
    } catch (e) { /* ignore */ }
    return list;
  }

  function manifestUrlCandidates() {
    const out = [];
    const seen = new Set();
    for (const base of dataBaseCandidates()) {
      try {
        const u = new URL("data/manifest.json", base).href;
        if (!seen.has(u)) {
          seen.add(u);
          out.push(u);
        }
      } catch (e) { /* ignore */ }
    }
    return out;
  }

  function datasetJsonUrlCandidates(stem) {
    const rel =
      /^[a-zA-Z0-9._-]+$/.test(stem)
        ? `data/${stem}.json`
        : `data/${encodeURIComponent(stem)}.json`;
    const out = [];
    const seen = new Set();
    for (const base of dataBaseCandidates()) {
      try {
        const u = new URL(rel, base).href;
        if (!seen.has(u)) {
          seen.add(u);
          out.push(u);
        }
      } catch (e) { /* ignore */ }
    }
    return out;
  }

  async function fetchJsonFirstOk(urls, label) {
    const stamp = Date.now();
    let lastStatus = "";
    for (let i = 0; i < urls.length; i++) {
      const raw = urls[i];
      const sep = raw.includes("?") ? "&" : "?";
      const url = `${raw}${sep}v=${stamp}`;
      try {
        const resp = await fetch(url, { cache: "no-store" });
        if (resp.ok) {
          if (typeof console !== "undefined" && console.info) {
            console.info(`[metro] ${label}: OK`, raw);
          }
          return { json: await resp.json(), urlUsed: raw };
        }
        lastStatus = `HTTP ${resp.status}`;
        if (typeof console !== "undefined" && console.warn) {
          console.warn(`[metro] ${label}:`, lastStatus, raw);
        }
      } catch (err) {
        lastStatus = err.message || String(err);
        if (typeof console !== "undefined" && console.warn) {
          console.warn(`[metro] ${label}:`, lastStatus, raw);
        }
      }
    }
    throw new Error(
      `${label} failed (${lastStatus}). Tried:\n` + urls.join("\n")
    );
  }

  async function loadDataset(name) {
    const urls = datasetJsonUrlCandidates(name);
    const { json } = await fetchJsonFirstOk(urls, "dataset");
    return json;
  }

  async function loadManifest() {
    const urls = manifestUrlCandidates();
    const { json, urlUsed } = await fetchJsonFirstOk(urls, "manifest");
    return { data: json, urlUsed };
  }

  function setManifestStatusLine(text) {
    let el = document.getElementById("metro-manifest-status");
    if (!el) {
      const bar = document.getElementById("dataset-bar");
      if (!bar) return;
      el = document.createElement("span");
      el.id = "metro-manifest-status";
      el.className = "manifest-status";
      el.setAttribute("title", "Resolved data path for manifest.json");
      bar.appendChild(el);
    }
    el.textContent = text;
  }

  /**
   * Filename stem format:
   *   "{baseName}_eps{p}" (unbalanced)
   *   "{baseName}_eps{p}_balanced_distribution" (balanced)
   * Parsed hierarchy for selectors: dataset -> eps -> distribution.
   */
  function parseDatasetStem(stem) {
    const balancedSuffix = "_balanced_distribution";
    const isBalanced = stem.endsWith(balancedSuffix);
    const core = isBalanced ? stem.slice(0, -balancedSuffix.length) : stem;
    const marker = "_eps";
    const i = core.lastIndexOf(marker);
    if (i < 0) {
      return {
        base: core,
        epsStr: null,
        epsNum: null,
        epsKey: "(default)",
        distribution: isBalanced ? "balanced" : "unbalanced",
        stem
      };
    }
    const base = core.slice(0, i);
    const epsStr = core.slice(i + marker.length);
    const epsNum = parseFloat(epsStr);
    return {
      base,
      epsStr,
      epsNum: Number.isFinite(epsNum) ? epsNum : null,
      epsKey: epsStr || "(default)",
      distribution: isBalanced ? "balanced" : "unbalanced",
      stem
    };
  }

  function groupDatasetsByBase(stems) {
    // Map<base, Map<epsKey, {epsStr, epsNum, variants: {balanced, unbalanced}}>>
    const map = new Map();
    for (const stem of stems) {
      const p = parseDatasetStem(stem);
      if (!map.has(p.base)) map.set(p.base, new Map());
      const byEps = map.get(p.base);
      if (!byEps.has(p.epsKey)) {
        byEps.set(p.epsKey, {
          epsKey: p.epsKey,
          epsStr: p.epsStr,
          epsNum: p.epsNum,
          variants: { balanced: null, unbalanced: null }
        });
      }
      byEps.get(p.epsKey).variants[p.distribution] = p.stem;
    }
    for (const byEps of map.values()) {
      for (const obj of byEps.values()) {
        if (!obj.variants.unbalanced && obj.variants.balanced) {
          // Keep an always-present default fallback.
          obj.variants.unbalanced = obj.variants.balanced;
        }
      }
    }
    return map;
  }

  let _datasetGroups = null;
  let _allStems = [];

  function fillDatasetNameSelect(groups) {
    const sel = document.getElementById("dataset-name-select");
    if (!sel) return;
    sel.innerHTML = "";
    const bases = [...groups.keys()].sort();
    for (const b of bases) {
      const opt = document.createElement("option");
      opt.value = b;
      opt.textContent = b;
      sel.appendChild(opt);
    }
  }

  function sortedEpsEntriesForBase(base) {
    if (!_datasetGroups) return [];
    const byEps = _datasetGroups.get(base);
    if (!byEps) return [];
    return [...byEps.values()].sort((a, b) => {
      if (a.epsNum == null && b.epsNum == null) return 0;
      if (a.epsNum == null) return 1;
      if (b.epsNum == null) return -1;
      return a.epsNum - b.epsNum;
    });
  }

  function fillEpsSelectForBase(base) {
    const epsSel = document.getElementById("dataset-eps-select");
    if (!epsSel || !_datasetGroups) return;
    const arr = sortedEpsEntriesForBase(base);
    epsSel.innerHTML = "";
    for (const p of arr) {
      const opt = document.createElement("option");
      opt.value = p.epsKey;
      opt.textContent = p.epsStr != null ? String(p.epsStr) : "(default)";
      epsSel.appendChild(opt);
    }
  }

  function fillBalanceSelectForBaseEps(base, epsKey) {
    const balSel = document.getElementById("dataset-balance-select");
    if (!balSel || !_datasetGroups) return;
    const byEps = _datasetGroups.get(base);
    const entry = byEps ? byEps.get(epsKey) : null;
    balSel.innerHTML = "";
    if (!entry) return;
    const addOpt = (id, label, stem) => {
      if (!stem) return;
      const opt = document.createElement("option");
      opt.value = stem;
      opt.textContent = label;
      balSel.appendChild(opt);
    };
    addOpt("unbalanced", "Unbalanced", entry.variants.unbalanced);
    addOpt("balanced", "Balanced", entry.variants.balanced);
  }

  function getCurrentDatasetStem() {
    const balSel = document.getElementById("dataset-balance-select");
    return balSel && balSel.value ? balSel.value : "";
  }

  function applyStemToSelectors(stem) {
    const p = parseDatasetStem(stem);
    const nameSel = document.getElementById("dataset-name-select");
    const epsSel = document.getElementById("dataset-eps-select");
    const balSel = document.getElementById("dataset-balance-select");
    if (!nameSel || !epsSel || !balSel) return false;
    if (![...nameSel.options].some(o => o.value === p.base)) {
      return false;
    }
    nameSel.value = p.base;
    fillEpsSelectForBase(p.base);
    if ([...epsSel.options].some(o => o.value === p.epsKey)) {
      epsSel.value = p.epsKey;
    } else if (epsSel.options.length) {
      epsSel.selectedIndex = 0;
    }
    fillBalanceSelectForBaseEps(nameSel.value, epsSel.value);
    if ([...balSel.options].some(o => o.value === stem)) {
      balSel.value = stem;
    } else if (balSel.options.length) {
      balSel.selectedIndex = 0;
    }
    return true;
  }

  function ensureDefaultDatasetSelection() {
    const nameSel = document.getElementById("dataset-name-select");
    const epsSel = document.getElementById("dataset-eps-select");
    const balSel = document.getElementById("dataset-balance-select");
    if (!nameSel || !epsSel || !balSel) return;
    const firstBase = nameSel.options[0] && nameSel.options[0].value;
    if (!firstBase) return;
    if (!nameSel.value) nameSel.value = firstBase;
    fillEpsSelectForBase(nameSel.value);
    if (epsSel.options.length && !epsSel.value) {
      epsSel.selectedIndex = 0;
    }
    fillBalanceSelectForBaseEps(nameSel.value, epsSel.value);
    if (balSel.options.length && !balSel.value) {
      balSel.selectedIndex = 0;
    }
  }

  // ── Build lookup structures ──────────────────────────────────────

  function buildLookups(data) {
    const nodeById = new Map();
    data.nodes.forEach(n => nodeById.set(n.id, n));

    const edgeLineSet = data.edges.map(e => new Set(e.lines));
    const edgeMediatedLineSet = data.edges.map(
      e => new Set(e.mediatedLines || []));
    const edgeSpecialChordLineSet = data.edges.map(
      e => new Set(e.specialChordLines || []));

    const bundleById = new Map();
    data.bundles.forEach(b => bundleById.set(b.id, b));

    return {
      nodeById,
      edgeLineSet,
      edgeMediatedLineSet,
      edgeSpecialChordLineSet,
      bundleById
    };
  }

  // ── Scales ───────────────────────────────────────────────────────

  function buildScales(data) {
    const container = document.getElementById("bary-panel") ||
      document.getElementById("map-container");
    if (!container) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    const { margin } = CONFIG;

    const { xExtent, yExtent, dataW, dataH } = collectLayoutExtents(data);
    const plotW = W - margin.left - margin.right;
    const plotH = H - margin.top - margin.bottom;
    const fx = layoutScaleXUser > 0 ? layoutScaleXUser : 1;
    // Anisotropic fit: wider effective x-span (dataW × fx) without changing data.
    const scaleY = Math.min(plotW / (dataW * fx), plotH / dataH);
    const scaleX = scaleY * fx;

    const offsetX = margin.left + (plotW - dataW * scaleX) / 2;
    const offsetY = margin.top + (plotH - dataH * scaleY) / 2;

    xScale = x => offsetX + (x - xExtent[0]) * scaleX;
    yScale = y => offsetY + (yExtent[1] - y) * scaleY;
  }

  const METRO_LAYOUT_SNAP = "__metroLayoutSnapshot";

  function ensureLayoutSnapshot(data) {
    if (!data || data[METRO_LAYOUT_SNAP]) return;
    data[METRO_LAYOUT_SNAP] = {
      nodes: data.nodes.map(n => ({ id: n.id, x: n.x, y: n.y })),
      bundles: (data.bundles || []).map(b => ({
        id: b.id,
        cx: b.cx,
        cy: b.cy,
      })),
      unpaired: (data.unpairedNodes || []).map(u => ({
        id: u.id,
        x: u.x,
        y: u.y,
      })),
    };
  }

  function restoreLayoutSnapshot(data) {
    const snap = data && data[METRO_LAYOUT_SNAP];
    if (!snap) return;
    const byNode = new Map(data.nodes.map(n => [n.id, n]));
    for (let i = 0; i < snap.nodes.length; i++) {
      const t = snap.nodes[i];
      const n = byNode.get(t.id);
      if (n) {
        n.x = t.x;
        n.y = t.y;
      }
    }
    const byBundle = new Map((data.bundles || []).map(b => [b.id, b]));
    for (let i = 0; i < snap.bundles.length; i++) {
      const t = snap.bundles[i];
      const b = byBundle.get(t.id);
      if (b) {
        b.cx = t.cx;
        b.cy = t.cy;
      }
    }
    const un = data.unpairedNodes || [];
    const byUn = new Map(un.map(u => [u.id, u]));
    for (let i = 0; i < snap.unpaired.length; i++) {
      const t = snap.unpaired[i];
      const u = byUn.get(t.id);
      if (u) {
        u.x = t.x;
        u.y = t.y;
      }
    }
  }

  function xLayoutEquals(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const s = Math.max(1, Math.abs(a), Math.abs(b));
    return Math.abs(a - b) <= 1e-9 * s;
  }

  function applyXGroupSwapToLayout(layoutData, xA, xB) {
    if (!layoutData) return;
    if (!Number.isFinite(xA) || !Number.isFinite(xB) || xA === xB) return;
    const nodes = layoutData.nodes || [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!Number.isFinite(n.x)) continue;
      if (xLayoutEquals(n.x, xA)) n.x = xB;
      else if (xLayoutEquals(n.x, xB)) n.x = xA;
    }
    const bundles = layoutData.bundles || [];
    for (let i = 0; i < bundles.length; i++) {
      const b = bundles[i];
      if (!Number.isFinite(b.cx)) continue;
      if (xLayoutEquals(b.cx, xA)) b.cx = xB;
      else if (xLayoutEquals(b.cx, xB)) b.cx = xA;
    }
  }

  function applyManualXSwaps(data) {
    const swaps = data && data.__manualXSwapPairs;
    if (!Array.isArray(swaps) || !swaps.length) return;
    for (let i = 0; i < swaps.length; i++) {
      const s = swaps[i];
      if (!s || !Number.isFinite(s.xA) || !Number.isFinite(s.xB)) continue;
      applyXGroupSwapToLayout(data, s.xA, s.xB);
    }
  }

  function swapSelectedNodeXWith(nodeIdA, nodeIdB) {
    if (!data || !Number.isFinite(nodeIdA) || !Number.isFinite(nodeIdB) || nodeIdA === nodeIdB) {
      return false;
    }
    const a = _nodeById ? _nodeById.get(nodeIdA) : null;
    const b = _nodeById ? _nodeById.get(nodeIdB) : null;
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(b.x)) return false;
    const xA = a.x;
    const xB = b.x;
    if (xLayoutEquals(xA, xB)) return true;
    if (!Array.isArray(data.__manualXSwapPairs)) data.__manualXSwapPairs = [];
    data.__manualXSwapPairs.push({ xA, xB });
    applyXGroupSwapToLayout(data, xA, xB);
    return true;
  }

  /**
   * Even-X (design): columns come **only** from barycenter `data.nodes` x-values (sorted,
   * merged within `tol` into `distinct[]`, so k ≤ number of nodes). Unpaired x is **not**
   * used to define columns; each unpaired point is snapped to the nearest node-derived
   * column. Those k columns map to evenly spaced x on `[distinct[0], distinct[k-1]]` with
   * padding. Bundle pass uses median member column index into the same `targets[]`.
   */
  function applyBarycenterEvenXDistribution(data) {
    if (!evenXDistribution || !data || !data.nodes || !data.nodes.length) return;

    const xs = [];
    data.nodes.forEach(n => {
      if (Number.isFinite(n.x)) xs.push(+n.x);
    });
    if (!xs.length) return;

    xs.sort((a, b) => a - b);
    const span0 = xs[xs.length - 1] - xs[0];
    const tol = Math.max(1e-9 * (span0 || 1), 1e-12);
    const distinct = [];
    for (let i = 0; i < xs.length; i++) {
      if (
        !distinct.length ||
        Math.abs(xs[i] - distinct[distinct.length - 1]) > tol
      ) {
        distinct.push(xs[i]);
      }
    }
    const k = distinct.length;
    const xMin = distinct[0];
    const xMax = distinct[k - 1];
    const span = xMax - xMin || 1;
    const f =
      CONFIG.evenXPaddingFraction != null ? CONFIG.evenXPaddingFraction : 0.04;
    const pad = span * f;
    let left = xMin + pad;
    let right = xMax - pad;
    if (right <= left) {
      const mid = (xMin + xMax) / 2;
      const w = span * Math.max(f, 0.02);
      left = mid - w / 2;
      right = mid + w / 2;
    }

    const targets = [];
    if (k === 1) {
      targets.push((left + right) / 2);
    } else {
      const inner = right - left;
      for (let i = 0; i < k; i++) {
        targets.push(left + (inner * i) / (k - 1));
      }
    }

    function colIndex(x) {
      let best = 0;
      let bd = Infinity;
      for (let j = 0; j < k; j++) {
        const d = Math.abs(x - distinct[j]);
        if (d < bd) {
          bd = d;
          best = j;
        }
      }
      return best;
    }

    const colByNodeId = new Map();
    for (let i = 0; i < data.nodes.length; i++) {
      const n = data.nodes[i];
      if (Number.isFinite(n.x)) colByNodeId.set(n.id, colIndex(+n.x));
    }
    const colByUnpairedId = new Map();
    (data.unpairedNodes || []).forEach(u => {
      if (Number.isFinite(u.x)) colByUnpairedId.set(u.id, colIndex(+u.x));
    });

    const byId = new Map(data.nodes.map(n => [n.id, n]));
    const bundles = data.bundles || [];

    if (CONFIG.debugEvenXLayout) {
      console.log("[even-x] k columns = distinct x anchors → evenly spaced targets[j]", {
        k,
        distinct,
        targets,
      });
    }

    for (let i = 0; i < data.nodes.length; i++) {
      const n = data.nodes[i];
      const j = colByNodeId.get(n.id);
      if (j !== undefined) n.x = targets[j];
    }
    if (CONFIG.debugEvenXLayout) {
      console.log("[even-x] after per-node x = targets[col]", data.nodes.map(n => ({
        nodeId: n.id,
        bundleId: n.bundle,
        col: colByNodeId.get(n.id),
        x: n.x,
      })));
    }

    (data.unpairedNodes || []).forEach(u => {
      const j = colByUnpairedId.get(u.id);
      if (j !== undefined) u.x = targets[j];
    });
    if (CONFIG.debugEvenXLayout) {
      console.log("[even-x] after unpaired x = targets[col]",
        (data.unpairedNodes || []).map(u => ({ id: u.id, x: u.x })));
    }

    for (let bi = 0; bi < bundles.length; bi++) {
      const b = bundles[bi];
      if (!b.members || !b.members.length) continue;
      const cols = [];
      let sy = 0;
      let c = 0;
      for (let mi = 0; mi < b.members.length; mi++) {
        const mid = b.members[mi].id;
        const nd = byId.get(mid);
        if (!nd || !colByNodeId.has(mid)) continue;
        cols.push(colByNodeId.get(mid));
        sy += nd.y;
        c++;
      }
      if (c > 0) {
        cols.sort((a, b) => a - b);
        const midCol = cols[(cols.length - 1) >> 1];
        const tx = targets[midCol];
        b.cx = tx;
        b.cy = sy / c;
        for (let mi = 0; mi < b.members.length; mi++) {
          const nd = byId.get(b.members[mi].id);
          if (nd) nd.x = tx;
        }
        if (CONFIG.debugEvenXLayout) {
          console.log("[even-x] after bundle remap", {
            bundleId: b.id,
            medianColIndex: midCol,
            cx: b.cx,
            cy: b.cy,
            memberNodeIds: b.members.map(mem => mem.id),
            memberXs: b.members.map(mem => {
              const nd = byId.get(mem.id);
              return nd ? { id: mem.id, x: nd.x } : { id: mem.id, x: null };
            }),
          });
        }
      }
    }

    if (CONFIG.debugEvenXLayout) {
      const focus = (CONFIG.debugEvenXFocusNodeIds || []).filter(nid => byId.has(nid));
      if (focus.length) {
        console.log("[even-x] focus nodes (final x after bundle pass)", focus.map(nid => {
          const n = byId.get(nid);
          return { nodeId: nid, bundleId: n.bundle, x: n.x };
        }));
      }
      console.log("[even-x] final bundle cx", bundles.map(b => ({
        bundleId: b.id,
        cx: b.cx,
        cy: b.cy,
      })));
    }
  }

  function collectLayoutExtents(data) {
    const allX = [];
    const allY = [];
    data.nodes.forEach(n => {
      allX.push(n.x);
      allY.push(n.y);
    });
    data.bundles.forEach(b => {
      allX.push(b.cx);
      allY.push(b.cy);
    });
    if (data.unpairedNodes) {
      data.unpairedNodes.forEach(u => {
        allX.push(u.x);
        allY.push(u.y);
      });
    }
    const xExtent = [Math.min(...allX), Math.max(...allX)];
    const yExtent = [Math.min(...allY), Math.max(...allY)];
    const dataW = xExtent[1] - xExtent[0] || 1;
    const dataH = yExtent[1] - yExtent[0] || 1;
    return { allX, allY, xExtent, yExtent, dataW, dataH };
  }

  function metroEdgeEndpoints(e) {
    if (e && typeof e === "object" && e.source !== undefined) {
      return [+e.source, +e.target];
    }
    if (Array.isArray(e) && e.length >= 2) return [+e[0], +e[1]];
    return [NaN, NaN];
  }

  function buildUndirectedAdjacency(edgeList, endpointsFn) {
    const adj = new Map();
    const add = (a, b) => {
      if (!Number.isFinite(a) || !Number.isFinite(b)) return;
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    };
    for (let i = 0; i < edgeList.length; i++) {
      const [u, v] = endpointsFn(edgeList[i]);
      add(u, v);
    }
    return adj;
  }

  /**
   * Sort by ascending function value; ties broken by DFS preorder from min-(height,id) roots.
   * Cumulative offset O[i]: for node at rank i, if some earlier neighbor has gap y_i - y_u < eps,
   * add (eps - gap) on top of O[i-1] so vertical separation in data space reaches ~eps.
   */
  function computeYAxisSeparationOffsets(nodeIds, edgeList, endpointsFn, baseYById, epsData) {
    const ids = [...new Set(nodeIds)].filter(id => baseYById.has(id));
    if (ids.length === 0) return new Map();

    const adj = buildUndirectedAdjacency(edgeList, endpointsFn);
    const heightOf = id => baseYById.get(id) ?? 0;

    const preorder = new Map();
    let tick = 0;
    const visited = new Set();

    function dfs(u, parent) {
      if (visited.has(u)) return;
      visited.add(u);
      preorder.set(u, tick++);
      const neigh = adj.get(u) || [];
      const kids = [];
      for (let j = 0; j < neigh.length; j++) {
        if (neigh[j] !== parent) kids.push(neigh[j]);
      }
      kids.sort((v1, v2) => {
        const h1 = heightOf(v1);
        const h2 = heightOf(v2);
        if (h1 !== h2) return h1 - h2;
        return v1 - v2;
      });
      for (let k = 0; k < kids.length; k++) dfs(kids[k], u);
    }

    function pickNextRoot() {
      let best = null;
      let bestH = null;
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (visited.has(id)) continue;
        const h = heightOf(id);
        if (best === null || h < bestH || (h === bestH && id < best)) {
          best = id;
          bestH = h;
        }
      }
      return best;
    }

    while (visited.size < ids.length) {
      const r = pickNextRoot();
      if (r == null) break;
      dfs(r, -1);
    }

    const sortedIds = [...ids].sort((a, b) => {
      const ha = heightOf(a);
      const hb = heightOf(b);
      if (ha !== hb) return ha - hb;
      return (preorder.get(a) ?? 0) - (preorder.get(b) ?? 0);
    });

    const rank = new Map();
    for (let i = 0; i < sortedIds.length; i++) rank.set(sortedIds[i], i);

    const O = new Array(sortedIds.length);
    O[0] = 0;
    for (let i = 1; i < sortedIds.length; i++) {
      const v = sortedIds[i];
      const yv = heightOf(v);
      let add = 0;
      const nbrs = adj.get(v) || [];
      for (let ni = 0; ni < nbrs.length; ni++) {
        const u = nbrs[ni];
        const ru = rank.get(u);
        if (ru === undefined || ru >= i) continue;
        const yu = heightOf(u);
        const gap = yv - yu;
        if (gap >= 0 && gap < epsData) {
          const need = epsData - gap;
          if (need > add) add = need;
        }
      }
      O[i] = O[i - 1] + add;
    }

    const offsetById = new Map();
    for (let i = 0; i < sortedIds.length; i++) {
      offsetById.set(sortedIds[i], O[i]);
    }
    return offsetById;
  }

  function getBarycenterYAxisSeparationFactor() {
    if (Number.isFinite(CONFIG.yAxisSeparationBaryEpsPxFactor)) {
      return CONFIG.yAxisSeparationBaryEpsPxFactor;
    }
    return Number.isFinite(CONFIG.yAxisSeparationEpsPxFactor)
      ? CONFIG.yAxisSeparationEpsPxFactor
      : 1.0;
  }

  function getInputTreeYAxisSeparationFactor() {
    if (Number.isFinite(CONFIG.yAxisSeparationInputTreeEpsPxFactor)) {
      return CONFIG.yAxisSeparationInputTreeEpsPxFactor;
    }
    return Number.isFinite(CONFIG.yAxisSeparationEpsPxFactor)
      ? CONFIG.yAxisSeparationEpsPxFactor
      : 1.0;
  }

  function applyBarycenterYAxisSeparation(data) {
    if (!CONFIG.yAxisSeparationEnabled || !data || !data.nodes || !data.edges) return;

    const nodes = data.nodes;
    const baseYById = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const h = Number.isFinite(n.height) ? n.height : n.y;
      baseYById.set(n.id, h);
    }

    const container = document.getElementById("bary-panel") ||
      document.getElementById("map-container");
    const W = container ? container.clientWidth : 800;
    const H = container ? container.clientHeight : 600;
    const { margin } = CONFIG;
    const plotH = Math.max(80, H - margin.top - margin.bottom);
    const plotW = Math.max(80, W - margin.left - margin.right);

    const hs = [];
    for (let i = 0; i < nodes.length; i++) hs.push(baseYById.get(nodes[i].id));
    const yMin = Math.min(...hs);
    const yMax = Math.max(...hs);
    const dataH = yMax - yMin || 1;
    const xs = nodes.map(n => n.x);
    const dataW = Math.max(...xs) - Math.min(...xs) || 1;
    const fx = CONFIG.layoutScaleX > 0 ? CONFIG.layoutScaleX : 1;
    const scaleY = Math.min(plotW / (dataW * fx), plotH / dataH);
    const refR = CONFIG.nodeRadiusBase + CONFIG.nodeRadiusPerMember;
    const epsPx = Math.max(4, refR * getBarycenterYAxisSeparationFactor());
    const epsData = epsPx / scaleY;

    const offsetById = computeYAxisSeparationOffsets(
      nodes.map(n => n.id),
      data.edges,
      metroEdgeEndpoints,
      baseYById,
      epsData
    );

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const b = baseYById.get(n.id);
      n.y = b + (offsetById.get(n.id) ?? 0);
    }

    const byId = new Map(nodes.map(n => [n.id, n]));
    const bundles = data.bundles || [];
    for (let bi = 0; bi < bundles.length; bi++) {
      const b = bundles[bi];
      if (!b.members || b.members.length <= 1) continue;
      let sx = 0;
      let sy = 0;
      let c = 0;
      for (let mi = 0; mi < b.members.length; mi++) {
        const nd = byId.get(b.members[mi].id);
        if (nd) {
          sx += nd.x;
          sy += nd.y;
          c++;
        }
      }
      if (c > 0) {
        b.cx = sx / c;
        b.cy = sy / c;
      }
    }
  }

  /**
   * Copy vizPos with layout y replaced by base function value + separation offset (panel coords).
   */
  function applyInputTreeYAxisSeparation(tree, graphNodeIds, vizPos, panelW, panelH) {
    if (!CONFIG.yAxisSeparationEnabled || !vizPos || !graphNodeIds.length) return vizPos;

    const rawEdges = tree.edges || [];
    const edgeObjs = [];
    for (let i = 0; i < rawEdges.length; i++) {
      const ends = normalizeInputEdge(rawEdges[i]);
      if (ends) edgeObjs.push({ source: ends[0], target: ends[1] });
    }

    const heights = tree.heights || {};
    const baseYById = new Map();
    for (let i = 0; i < graphNodeIds.length; i++) {
      const id = graphNodeIds[i];
      const k = String(id);
      let yv = heights[k];
      if (yv === undefined) yv = heights[id];
      const vp = vizPos[k] ?? vizPos[id];
      if (!Number.isFinite(yv) && vp && Array.isArray(vp) && vp.length >= 2) {
        yv = +vp[1];
      }
      if (Number.isFinite(yv)) baseYById.set(id, +yv);
    }
    if (baseYById.size < 2) return vizPos;

    const xs = [];
    for (let i = 0; i < graphNodeIds.length; i++) {
      const id = graphNodeIds[i];
      const vp = vizPos[String(id)] ?? vizPos[id];
      if (vp && Array.isArray(vp) && vp.length >= 1) xs.push(+vp[0]);
    }
    const ys = [];
    baseYById.forEach(v => ys.push(v));
    const dataW = xs.length ? Math.max(...xs) - Math.min(...xs) || 1 : 1;
    const dataH = Math.max(...ys) - Math.min(...ys) || 1;
    const pad = 14;
    const innerW = Math.max(40, panelW - 2 * pad);
    const innerH = Math.max(40, panelH - 2 * pad);
    const s = Math.min(innerW / dataW, innerH / dataH);
    const refR = CONFIG.nodeRadiusBase + CONFIG.nodeRadiusPerMember;
    const epsPx = Math.max(4, refR * getInputTreeYAxisSeparationFactor());
    const epsData = epsPx / s;

    const offsetById = computeYAxisSeparationOffsets(
      graphNodeIds,
      edgeObjs,
      metroEdgeEndpoints,
      baseYById,
      epsData
    );

    const out = {};
    const keys = Object.keys(vizPos);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = vizPos[k];
      if (Array.isArray(p) && p.length >= 2) {
        out[k] = [+p[0], +p[1]];
      }
    }
    for (let i = 0; i < graphNodeIds.length; i++) {
      const id = graphNodeIds[i];
      const k = String(id);
      if (!out[k]) continue;
      const base = baseYById.get(id);
      if (base === undefined) continue;
      out[k][1] = base + (offsetById.get(id) ?? 0);
    }
    return Object.keys(out).length ? out : vizPos;
  }

  function cloneVizPosMap(vizPos) {
    const out = {};
    const keys = Object.keys(vizPos);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const p = vizPos[k];
      if (Array.isArray(p) && p.length >= 2) out[k] = [+p[0], +p[1]];
    }
    return out;
  }

  /**
   * After y-axis separation, notebook-exported polylines still use pre-offset y; remap each
   * vertex y by matching old layout height to a node (prefer ids on that segment).
   */
  function adjustVizEdgeSegmentsY(segments, segmentNodeIds, oldVizPos, newVizPos) {
    if (!segments || !oldVizPos || !newVizPos) return segments;
    const tol = 1e-5;
    function remapY(py, preferredIds) {
      const pref =
        preferredIds && preferredIds.length
          ? new Set(preferredIds.map(id => +id))
          : null;
      const matches = [];
      const keys = Object.keys(oldVizPos);
      for (let ki = 0; ki < keys.length; ki++) {
        const k = keys[ki];
        const o = oldVizPos[k];
        if (!Array.isArray(o) || o.length < 2) continue;
        if (Math.abs(+o[1] - py) < tol) matches.push(+k);
      }
      if (!matches.length) return py;
      let pick;
      if (pref) {
        const inPref = matches.filter(id => pref.has(id));
        pick = inPref.length ? Math.min(...inPref) : Math.min(...matches);
      } else {
        pick = Math.min(...matches);
      }
      const nk = String(pick);
      const n = newVizPos[nk] ?? newVizPos[pick];
      return n && Array.isArray(n) && n.length >= 2 ? +n[1] : py;
    }
    const out = [];
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si];
      if (!Array.isArray(seg)) {
        out.push(seg);
        continue;
      }
      const nidRow =
        segmentNodeIds && segmentNodeIds[si] ? segmentNodeIds[si] : [];
      const copy = [];
      for (let pi = 0; pi < seg.length; pi++) {
        const pt = seg[pi];
        if (!Array.isArray(pt) || pt.length < 2) {
          copy.push(pt);
          continue;
        }
        copy.push([+pt[0], remapY(+pt[1], nidRow)]);
      }
      out.push(copy);
    }
    return out;
  }

  // ── Edge width helpers ───────────────────────────────────────────

  function computeEdgeWidth(pop, maxPop) {
    if (maxPop <= 0) return CONFIG.minEdgeWidth;
    const ratio = pop / maxPop;
    const t = Math.pow(ratio, CONFIG.edgeWidthPower);
    return CONFIG.minEdgeWidth +
      (CONFIG.maxEdgeWidth - CONFIG.minEdgeWidth) * t;
  }

  /**
   * Matched (field x,y) for bary node, optionally restricted to legend-selected inputs.
   * @param {Set<number>|null|undefined} selectedInputSet — if nullish, use all inputs in byInput.
   */
  function collectMatchedHeightsForBary(data, baryId, selectedInputSet) {
    const nmi = data && data.nodeMatchIndex;
    if (!nmi) return [];
    const idx = nmi[String(baryId)] ?? nmi[baryId];
    if (!idx || !idx.byInput) return [];
    const out = [];
    const by = idx.byInput;
    const keys = Object.keys(by);
    for (let ki = 0; ki < keys.length; ki++) {
      const inputIdx = +keys[ki];
      if (Number.isNaN(inputIdx)) continue;
      if (selectedInputSet && !selectedInputSet.has(inputIdx)) continue;
      const arr = by[keys[ki]];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        if (r && Number.isFinite(+r.height)) out.push(+r.height);
      }
    }
    return out;
  }

  function sampleStdDev(values) {
    const n = values.length;
    if (n < 2) return 0;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += values[i];
    const mean = sum / n;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const d = values[i] - mean;
      ss += d * d;
    }
    return Math.sqrt(ss / (n - 1));
  }

  /**
   * Per barycenter node id: std of matched heights (selected inputs only).
   * maxStd: largest such std across nodes (for rescaling); ≥ tiny positive.
   */
  function computeHeightStdScale(data, selectedInputSet) {
    const byId = new Map();
    if (!data || !data.nodes || !data.nodes.length) {
      return { maxStd: 1e-12, byId };
    }
    let maxStd = 0;
    for (let i = 0; i < data.nodes.length; i++) {
      const nid = data.nodes[i].id;
      const h = collectMatchedHeightsForBary(data, nid, selectedInputSet);
      const s = sampleStdDev(h);
      byId.set(nid, s);
      maxStd = Math.max(maxStd, s);
    }
    const maxScale = maxStd > 1e-15 ? maxStd : 1e-12;
    return { maxStd: maxScale, byId };
  }

  function loadBaryUncertaintyPrefs() {
    try {
      const s = localStorage.getItem(LS_BARY_UNCERTAINTY_MODE);
      if (s === "functionVariation" || s === "probabilistic") {
        CONFIG.baryNodeUncertaintyMode = s;
      }
    } catch (e) { /* ignore */ }
  }

  function persistBaryUncertaintyMode() {
    try {
      localStorage.setItem(
        LS_BARY_UNCERTAINTY_MODE,
        CONFIG.baryNodeUncertaintyMode);
    } catch (e) { /* ignore */ }
  }

  function loadHideZeroSubstantialNodesPref() {
    try {
      const s = localStorage.getItem(LS_HIDE_ZERO_SUBSTANTIAL_NODES);
      if (s === "1" || s === "true") hideZeroSubstantialNodes = true;
      else if (s === "0" || s === "false") hideZeroSubstantialNodes = false;
    } catch (e) { /* ignore */ }
  }

  function persistHideZeroSubstantialNodesPref() {
    try {
      localStorage.setItem(
        LS_HIDE_ZERO_SUBSTANTIAL_NODES,
        hideZeroSubstantialNodes ? "1" : "0");
    } catch (e) { /* ignore */ }
  }

  function loadLayoutScaleXPref() {
    try {
      const s = localStorage.getItem(LS_LAYOUT_SCALE_X);
      const v = Number(s);
      if (Number.isFinite(v) && v >= 0.5 && v <= 3.0) layoutScaleXUser = v;
    } catch (e) { /* ignore */ }
  }

  function persistLayoutScaleXPref() {
    try {
      localStorage.setItem(LS_LAYOUT_SCALE_X, String(layoutScaleXUser));
    } catch (e) { /* ignore */ }
  }

  /** Collect pre-thresholded coupling masses for `nd` over legend-selected inputs. */
  function collectCouplingMassValuesForNode(nd, selectedInputSet) {
    const m = nd.couplingRowMasses;
    if (!Array.isArray(m) || !data || !data.lines) return [];
    const vals = [];
    for (let li = 0; li < data.lines.length; li++) {
      const line = data.lines[li];
      if (!selectedInputSet.has(line.id)) continue;
      // `couplingRowMasses` is ordered like `lines` (input index s in prepare_data).
      const block = m[li];
      if (!Array.isArray(block)) continue;
      for (let j = 0; j < block.length; j++) vals.push(block[j]);
    }
    return vals;
  }

  function computeSubstantialMatchNodeIdSet(dataObj) {
    const out = new Set();
    if (!dataObj || !Array.isArray(dataObj.nodes)) {
      return out;
    }
    // Primary criterion: explicit input correspondence from prepare_data route matching.
    if (Array.isArray(dataObj.lines)) {
      for (let li = 0; li < dataObj.lines.length; li++) {
        const ln = dataObj.lines[li];
        const mn = ln && Array.isArray(ln.matchedNodes) ? ln.matchedNodes : [];
        for (let mi = 0; mi < mn.length; mi++) out.add(+mn[mi]);
      }
      return out;
    }
    // Fallback for legacy JSON: explicit nodeMatchIndex records.
    for (let i = 0; i < dataObj.nodes.length; i++) {
      const nd = dataObj.nodes[i];
      const idx = dataObj.nodeMatchIndex ? dataObj.nodeMatchIndex[String(nd.id)] : null;
      const byInput = idx && idx.byInput ? idx.byInput : null;
      if (!byInput) continue;
      const keys = Object.keys(byInput);
      for (let ki = 0; ki < keys.length; ki++) {
        const arr = byInput[keys[ki]];
        if (Array.isArray(arr) && arr.length > 0) {
          out.add(nd.id);
          break;
        }
      }
    }
    return out;
  }

  function isBaryNodeHiddenByFilter(nodeId) {
    return hideZeroSubstantialNodes && !_substantialMatchNodeIds.has(+nodeId);
  }

  /**
   * Equal-width binning on [0, vmax] with vmax = max finite value (same as map entropy).
   * Avoids unstable bins when min and max in the sample are very close. Negative masses
   * are clamped to 0 for placement. Shannon H uses p_i = counts[i] / n (n = vals.length).
   */
  function couplingMassBinningDetails(vals, nBins) {
    const n = vals.length;
    const empty = { counts: [], vmin: null, vmax: null, n: 0, H: 0, nBins: 0 };
    if (n < 1 || !Number.isFinite(nBins) || nBins < 1) return empty;
    let vmax = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (Number.isFinite(v) && v > vmax) vmax = v;
    }
    if (!Number.isFinite(vmax)) return empty;
    vmax = Math.max(0, vmax);
    const counts = new Array(nBins).fill(0);
    if (!(vmax > 0)) {
      counts[0] = n;
      return { counts, vmin: 0, vmax: 0, n, H: 0, nBins };
    }
    const span = vmax;
    for (let i = 0; i < n; i++) {
      const v = vals[i];
      if (!Number.isFinite(v)) continue;
      const vc = Math.max(0, v);
      const t = vc / span;
      const b = Math.min(nBins - 1, Math.floor(t * nBins));
      counts[b]++;
    }
    let H = 0;
    for (let b = 0; b < nBins; b++) {
      const p = counts[b] / n;
      if (p > 0) H -= p * Math.log(p);
    }
    return { counts, vmin: 0, vmax: span, n, H, nBins };
  }

  /** Shannon entropy (nats); same binning as `couplingMassBinningDetails`. */
  function binnedShannonEntropy(vals, nBins) {
    return couplingMassBinningDetails(vals, nBins).H;
  }

  /**
   * Per-node Shannon entropy of binned coupling masses (selected inputs only).
   * Same shape as computeHeightStdScale for reuse with stdToSequentialVariationFill.
   */
  function computeProbCouplingEntropyScale(data, selectedInputSet) {
    const byId = new Map();
    if (!data || !data.nodes || !data.nodes.length) {
      return { maxStd: 1e-12, byId };
    }
    const pu = data.meta && data.meta.probUncertainty;
    const nBins = (pu && Number.isFinite(pu.entropyBins) && pu.entropyBins > 0)
      ? Math.floor(pu.entropyBins)
      : 5;
    let maxH = 0;
    for (let i = 0; i < data.nodes.length; i++) {
      const nd = data.nodes[i];
      const vals = collectCouplingMassValuesForNode(nd, selectedInputSet);
      const H = binnedShannonEntropy(vals, nBins);
      byId.set(nd.id, H);
      maxH = Math.max(maxH, H);
    }
    const maxScale = maxH > 1e-15 ? maxH : 1e-12;
    return { maxStd: maxScale, byId };
  }

  function computeActiveUncertaintyScale(data, selectedInputSet) {
    if (CONFIG.baryNodeUncertaintyMode === "probabilistic") {
      return computeProbCouplingEntropyScale(data, selectedInputSet);
    }
    return computeHeightStdScale(data, selectedInputSet);
  }

  /** Non-categorical bary map: function σ or probabilistic coupling entropy inside ellipse. */
  function functionUncertaintyActive(catMode) {
    return !catMode && (
      CONFIG.baryNodeUncertaintyMode === "functionVariation" ||
      CONFIG.baryNodeUncertaintyMode === "probabilistic");
  }

  /** Sequential colors for the active uncertainty mode (σ vs coupling H). */
  function activeUncertaintySequentialColors() {
    return CONFIG.baryNodeUncertaintyMode === "probabilistic"
      ? CONFIG.couplingUncertaintyColors
      : CONFIG.stdVariationColors;
  }

  /**
   * Map value linearly to [0, 1] vs maxStd, then interpolate along the active
   * uncertainty palette ({@link CONFIG.stdVariationColors} or
   * {@link CONFIG.couplingUncertaintyColors}).
   */
  function stdToSequentialVariationFill(std, maxStd) {
    const colors = activeUncertaintySequentialColors();
    if (!colors || !colors.length) return "#adb5bd";
    const denom = maxStd > 1e-15 ? maxStd : 1e-12;
    const t = Math.min(1, Math.max(0, std / denom));
    const n = colors.length;
    if (n === 1) return colors[0];
    const pos = t * (n - 1);
    const i = Math.min(Math.floor(pos), n - 2);
    const f = pos - i;
    const c0 = d3.color(colors[i]);
    const c1 = d3.color(colors[i + 1]);
    if (!c0 || !c1) return colors[i];
    // D3 v7: interpolateRgb returns an rgb string, not a color object with .formatHex().
    const blended = d3.color(d3.interpolateRgb(c0, c1)(f));
    return blended ? blended.formatHex() : colors[i];
  }

  /** CSS `linear-gradient` matching `stdToSequentialVariationFill` (low at bottom, high at top). */
  function stdVariationColorsToLinearGradient(colors) {
    if (!colors || !colors.length) return "linear-gradient(to top, #adb5bd, #adb5bd)";
    const n = colors.length;
    if (n === 1) return colors[0];
    const parts = colors.map((c, i) =>
      `${c} ${((100 * i) / (n - 1)).toFixed(3)}%`);
    return `linear-gradient(to top, ${parts.join(", ")})`;
  }

  function formatHeightStdLegendValue(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a === 0) return "0";
    if (a < 1e-6) return v.toExponential(1);
    if (a < 0.001) return v.toExponential(2);
    if (a < 0.01) return v.toFixed(4);
    if (a < 1) return v.toFixed(3);
    return v.toFixed(2);
  }

  function updateBaryStdColorbarPanel(uncPack) {
    const root = document.getElementById("bary-std-colorbar");
    const ramp = document.getElementById("bary-std-colorbar-ramp");
    const maxEl = document.getElementById("bary-std-colorbar-max");
    const titleEl = document.getElementById("bary-std-colorbar-title");
    const subEl = document.getElementById("bary-std-colorbar-subtitle");
    const headEl = root && root.querySelector(".bary-std-colorbar-head");
    if (!root || !ramp || !maxEl) return;
    const show = !!(
      data &&
      !baryCenterCategoricalNodeEncoding() &&
      (CONFIG.baryNodeUncertaintyMode === "functionVariation" ||
        CONFIG.baryNodeUncertaintyMode === "probabilistic")
    );
    if (!show) {
      root.classList.add("bary-std-colorbar-hidden");
      root.setAttribute("aria-hidden", "true");
      return;
    }
    root.classList.remove("bary-std-colorbar-hidden");
    root.setAttribute("aria-hidden", "false");
    ramp.style.background = stdVariationColorsToLinearGradient(
      activeUncertaintySequentialColors());
    const mx = uncPack && uncPack.maxStd;
    maxEl.textContent = formatHeightStdLegendValue(mx);
    const prob = CONFIG.baryNodeUncertaintyMode === "probabilistic";
    if (titleEl) {
      titleEl.textContent = prob
        ? "H (coupling entropy)"
        : "\u03c3(function value)";
    }
    if (subEl) {
      subEl.textContent = prob
        ? ""
        : "";
    }
    if (headEl) {
      headEl.title = prob
        ? "Entropy of coupling values \u2265 threshold \u00d7 row sum per input, " +
          "binned uniformly on [0, max mass]; max rescaled to palette top."
        : "Standard deviation of function values at matched critical points. " +
          "Uses only inputs selected in the legend; max is rescaled to the palette top.";
    }
    ramp.setAttribute(
      "aria-label",
      prob
        ? "Color scale: Shannon entropy of thresholded coupling masses, across selected inputs"
        : "Color scale: sigma of function values at matched critical points, across selected inputs; maximum on the scale is the largest sigma in view"
    );
  }

  function meanMemberHeightStd(bundle, heightStdPack) {
    const mem = bundle && bundle.members;
    if (!mem || !mem.length) return 0;
    let s = 0;
    for (let i = 0; i < mem.length; i++) {
      s += heightStdPack.byId.get(mem[i].id) || 0;
    }
    return s / mem.length;
  }

  function averageMemberChromaticFill(bundle) {
    const mem = bundle && bundle.members;
    if (!mem || !mem.length) return "#6c757d";
    let r = 0;
    let g = 0;
    let b = 0;
    let c = 0;
    for (let i = 0; i < mem.length; i++) {
      const col = d3.color(mem[i].color);
      if (col) {
        r += col.r;
        g += col.g;
        b += col.b;
        c++;
      }
    }
    if (!c) return "#6c757d";
    return d3.rgb(r / c, g / c, b / c).formatHex();
  }

  function collectMatchedFieldCoordsForBary(data, baryId, selectedInputSet) {
    const nmi = data && data.nodeMatchIndex;
    if (!nmi) return [];
    const idx = nmi[String(baryId)] ?? nmi[baryId];
    if (!idx || !idx.byInput) return [];
    const out = [];
    const by = idx.byInput;
    const keys = Object.keys(by);
    for (let ki = 0; ki < keys.length; ki++) {
      const inputIdx = +keys[ki];
      if (Number.isNaN(inputIdx)) continue;
      if (selectedInputSet && !selectedInputSet.has(inputIdx)) continue;
      const arr = by[keys[ki]];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const r = arr[i];
        const c = r && r.coord;
        if (c && Number.isFinite(+c.x) && Number.isFinite(+c.y)) {
          out.push({ x: +c.x, y: +c.y });
        }
      }
    }
    return out;
  }

  function chebyshevStatFromPts(pts) {
    if (!pts.length) return 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pts.length; i++) {
      sx += pts[i].x;
      sy += pts[i].y;
    }
    const n = pts.length;
    const cx = sx / n;
    const cy = sy / n;
    let m = 0;
    for (let i = 0; i < pts.length; i++) {
      const dx = Math.abs(pts[i].x - cx);
      const dy = Math.abs(pts[i].y - cy);
      m = Math.max(m, Math.max(dx, dy));
    }
    return m;
  }

  /**
   * PC1 / PC2 from centered covariance (principal directions in field x,y).
   * half1 / half2 = max |projection| onto PC1 / PC2 from centroid (field coordinates).
   */
  function pcaAxesAndExtents(pts) {
    const n = pts.length;
    if (n < 2) return null;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < pts.length; i++) {
      sx += pts[i].x;
      sy += pts[i].y;
    }
    const mx = sx / n;
    const my = sy / n;
    let cxx = 0;
    let cyy = 0;
    let cxy = 0;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i].x - mx;
      const py = pts[i].y - my;
      cxx += px * px;
      cyy += py * py;
      cxy += px * py;
    }
    cxx /= n;
    cyy /= n;
    cxy /= n;
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    let e1x = Math.cos(theta);
    let e1y = Math.sin(theta);
    const e2x = -e1y;
    const e2y = e1x;
    let h1 = 0;
    let h2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i].x - mx;
      const py = pts[i].y - my;
      const t1 = px * e1x + py * e1y;
      const t2 = px * e2x + py * e2y;
      h1 = Math.max(h1, Math.abs(t1));
      h2 = Math.max(h2, Math.abs(t2));
    }
    return { e1x, e1y, half1: h1, half2: h2 };
  }

  function rawHalfToSemiPx(rawHalf, maxCoordDiff, rPx) {
    const lo = CONFIG.coordUncertaintyAxisMinFrac;
    const hi = CONFIG.coordUncertaintyAxisMaxFrac;
    const denom = maxCoordDiff > 1e-15 ? maxCoordDiff : 1e-15;
    const t = Math.min(1, Math.max(0, rawHalf / denom));
    return rPx * (lo + (hi - lo) * t);
  }

  function ellipsePxFromSpec(spec, rPx) {
    if (!spec || !Number.isFinite(spec.maxCoordDiff) || spec.maxCoordDiff <= 0) {
      return null;
    }
    return {
      rx: rawHalfToSemiPx(spec.half1, spec.maxCoordDiff, rPx),
      ry: rawHalfToSemiPx(spec.half2, spec.maxCoordDiff, rPx),
      angleDeg: Math.atan2(spec.e1y, spec.e1x) * 180 / Math.PI,
    };
  }

  function specDrawsCoordEllipse(spec, rPx) {
    if (!CONFIG.coordUncertaintyEllipsoidEnabled || !spec) return false;
    const ell = ellipsePxFromSpec(spec, rPx);
    return !!(ell && ell.rx > 0 && ell.ry > 0);
  }

  /** Insert before `.station-outline-ring`; `fill` is coord-ellipse interior (e.g. sequential std). */
  function insertCoordUncertaintyEllipse(g, rPx, spec, chromaticFill) {
    if (!CONFIG.coordUncertaintyEllipsoidEnabled || !g || !spec) return;
    const ell = ellipsePxFromSpec(spec, rPx);
    if (!ell || !(ell.rx > 0) || !(ell.ry > 0)) return;
    const fill = chromaticFill || "#adb5bd";
    const rot =
      Math.abs(ell.angleDeg) > 1e-6 ? `rotate(${ell.angleDeg})` : "";
    const before = g.select(".station-outline-ring");
    const node = before.empty()
      ? g.append("ellipse")
      : g.insert("ellipse", ".station-outline-ring");
    node
      .attr("class", "coord-uncertainty-ellipse")
      .attr("cx", 0)
      .attr("cy", 0)
      .attr("rx", ell.rx)
      .attr("ry", ell.ry)
      .attr("fill", fill)
      .attr("fill-opacity", 0.92)
      .attr("stroke", isLightColor(fill) ? "#343a40" : "#1a1a1a")
      .attr("stroke-width", 1.5)
      .attr("pointer-events", "none");
    if (rot) node.attr("transform", rot);
  }

  /**
   * maxCoordDiff: max over bary nodes of (max over matched points of max(|dx|,|dy|)) in field space.
   * byId: bary node id -> { half1, half2, e1x, e1y, maxCoordDiff } for PCA ellipse (>=2 points).
   * selectedInputSet: legend selection (same semantics as getSelectionSet); omit for all inputs.
   */
  function computeAllCoordUncertainties(data, selectedInputSet) {
    const byId = new Map();
    if (!data || !data.nodes || !data.nodes.length) {
      return { maxCoordDiff: 1e-9, byId };
    }
    let globalMax = 0;
    for (let i = 0; i < data.nodes.length; i++) {
      const pts = collectMatchedFieldCoordsForBary(
        data, data.nodes[i].id, selectedInputSet);
      if (pts.length) {
        globalMax = Math.max(globalMax, chebyshevStatFromPts(pts));
      }
    }
    const maxCoordDiff = globalMax > 1e-15 ? globalMax : 1e-9;

    for (let i = 0; i < data.nodes.length; i++) {
      const nid = data.nodes[i].id;
      const pts = collectMatchedFieldCoordsForBary(data, nid, selectedInputSet);
      if (!pts.length) continue;
      if (pts.length === 1) {
        byId.set(nid, {
          half1: 0,
          half2: 0,
          e1x: 1,
          e1y: 0,
          maxCoordDiff,
        });
        continue;
      }
      const pca = pcaAxesAndExtents(pts);
      if (!pca) continue;
      byId.set(nid, {
        half1: pca.half1,
        half2: pca.half2,
        e1x: pca.e1x,
        e1y: pca.e1y,
        maxCoordDiff,
      });
    }
    return { maxCoordDiff, byId };
  }

  function collectPooledCoordsForBundle(data, bundle, selectedInputSet) {
    const all = [];
    const mem = bundle.members || [];
    for (let mi = 0; mi < mem.length; mi++) {
      const pts = collectMatchedFieldCoordsForBary(
        data, mem[mi].id, selectedInputSet);
      for (let pi = 0; pi < pts.length; pi++) all.push(pts[pi]);
    }
    return all;
  }

  function bundleCoordUncertaintySpec(data, bundle, maxCoordDiff, selectedInputSet) {
    const pts = collectPooledCoordsForBundle(data, bundle, selectedInputSet);
    if (!pts.length) return null;
    if (pts.length === 1) {
      return {
        half1: 0,
        half2: 0,
        e1x: 1,
        e1y: 0,
        maxCoordDiff,
      };
    }
    const pca = pcaAxesAndExtents(pts);
    if (!pca) return null;
    return {
      half1: pca.half1,
      half2: pca.half2,
      e1x: pca.e1x,
      e1y: pca.e1y,
      maxCoordDiff,
    };
  }

  function loadNodeColorPrefs() {
    try {
      const s = localStorage.getItem(LS_NODE_COLOR_SCHEME);
      if (s === "file" || s === "categorical") nodeColorScheme = s;
      else if (s === "hue" || s === "custom") nodeColorScheme = "categorical";
    } catch (e) { /* ignore */ }
  }

  function loadNodeColorOverrideBlob() {
    if (_nodeColorOverrideBlob !== null) return _nodeColorOverrideBlob;
    try {
      const raw = localStorage.getItem(LS_NODE_OVERRIDES);
      _nodeColorOverrideBlob = raw ? JSON.parse(raw) : {};
      if (!_nodeColorOverrideBlob || typeof _nodeColorOverrideBlob !== "object") {
        _nodeColorOverrideBlob = {};
      }
    } catch (e) {
      _nodeColorOverrideBlob = {};
    }
    return _nodeColorOverrideBlob;
  }

  function refreshNodeColorOverridesForCurrentStem() {
    const stem = getCurrentDatasetStem();
    _nodeColorOverrides = new Map();
    if (!stem) return;
    const blob = loadNodeColorOverrideBlob();
    const o = blob[stem];
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      const hex = o[k];
      if (typeof hex === "string" && /^#[0-9a-fA-F]{6}$/i.test(hex)) {
        _nodeColorOverrides.set(+k, hex.toLowerCase());
      }
    }
  }

  function persistNodeColorOverrideBlob() {
    try {
      localStorage.setItem(
        LS_NODE_OVERRIDES,
        JSON.stringify(_nodeColorOverrideBlob));
    } catch (e) { /* quota */ }
  }

  function setNodeColorOverrideForCurrentStem(nodeId, hex) {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/i.test(hex)) return;
    const norm = hex.toLowerCase();
    loadNodeColorOverrideBlob();
    if (!_nodeColorOverrideBlob[stem]) _nodeColorOverrideBlob[stem] = {};
    _nodeColorOverrideBlob[stem][String(nodeId)] = norm;
    persistNodeColorOverrideBlob();
    _nodeColorOverrides.set(nodeId, norm);
  }

  function removeNodeColorOverrideForCurrentStem(nodeId) {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    loadNodeColorOverrideBlob();
    if (_nodeColorOverrideBlob[stem]) {
      delete _nodeColorOverrideBlob[stem][String(nodeId)];
    }
    persistNodeColorOverrideBlob();
    _nodeColorOverrides.delete(nodeId);
  }

  function clearAllNodeColorOverridesForCurrentStem() {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    loadNodeColorOverrideBlob();
    _nodeColorOverrideBlob[stem] = {};
    persistNodeColorOverrideBlob();
    _nodeColorOverrides = new Map();
  }

  function loadLineColorOverrideBlob() {
    if (_lineColorOverrideBlob !== null) return _lineColorOverrideBlob;
    try {
      const raw = localStorage.getItem(LS_LINE_OVERRIDES);
      _lineColorOverrideBlob = raw ? JSON.parse(raw) : {};
      if (!_lineColorOverrideBlob || typeof _lineColorOverrideBlob !== "object") {
        _lineColorOverrideBlob = {};
      }
    } catch (e) {
      _lineColorOverrideBlob = {};
    }
    return _lineColorOverrideBlob;
  }

  function refreshLineColorOverridesForCurrentStem() {
    const stem = getCurrentDatasetStem();
    _lineColorOverrides = new Map();
    if (!stem) return;
    const blob = loadLineColorOverrideBlob();
    const o = blob[stem];
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      const hex = o[k];
      if (typeof hex === "string" && /^#[0-9a-fA-F]{6}$/i.test(hex)) {
        _lineColorOverrides.set(+k, hex.toLowerCase());
      }
    }
  }

  function persistLineColorOverrideBlob() {
    try {
      localStorage.setItem(
        LS_LINE_OVERRIDES,
        JSON.stringify(_lineColorOverrideBlob));
    } catch (e) { /* quota */ }
  }

  function setLineColorOverrideForCurrentStem(lineId, hex) {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/i.test(hex)) return;
    const norm = hex.toLowerCase();
    loadLineColorOverrideBlob();
    if (!_lineColorOverrideBlob[stem]) _lineColorOverrideBlob[stem] = {};
    _lineColorOverrideBlob[stem][String(lineId)] = norm;
    persistLineColorOverrideBlob();
    _lineColorOverrides.set(+lineId, norm);
  }

  function removeLineColorOverrideForCurrentStem(lineId) {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    loadLineColorOverrideBlob();
    if (_lineColorOverrideBlob[stem]) {
      delete _lineColorOverrideBlob[stem][String(lineId)];
    }
    persistLineColorOverrideBlob();
    _lineColorOverrides.delete(+lineId);
  }

  function clearAllLineColorOverridesForCurrentStem() {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    loadLineColorOverrideBlob();
    _lineColorOverrideBlob[stem] = {};
    persistLineColorOverrideBlob();
    _lineColorOverrides = new Map();
  }

  function ensureFileNodeColorsBackup(data) {
    if (!data || data.__fileNodeColors) return;
    const m = new Map();
    for (let i = 0; i < data.nodes.length; i++) {
      const n = data.nodes[i];
      m.set(n.id, n.color);
    }
    const bundles = data.bundles || [];
    for (let bi = 0; bi < bundles.length; bi++) {
      const mem = bundles[bi].members || [];
      for (let mi = 0; mi < mem.length; mi++) {
        const mm = mem[mi];
        if (!m.has(mm.id)) m.set(mm.id, mm.color);
      }
    }
    data.__fileNodeColors = m;
  }

  function buildBaryNodeIndexInfo(data) {
    const order = data.nodesOrderCenter;
    if (Array.isArray(order) && order.length) {
      const m = new Map();
      for (let i = 0; i < order.length; i++) m.set(order[i], i);
      const sortedIds = data.nodes.map(n => n.id).sort((a, b) => a - b);
      const fallback = new Map(sortedIds.map((id, i) => [id, i]));
      return {
        n: order.length,
        indexOf: id =>
          (m.has(id) ? m.get(id) : fallback.get(id)) ?? 0,
      };
    }
    const ids = data.nodes.map(n => n.id).sort((a, b) => a - b);
    const m = new Map(ids.map((id, i) => [id, i]));
    return { n: ids.length, indexOf: id => m.get(id) ?? 0 };
  }

  function computeBaryNodeDisplayColorMap(data) {
    ensureFileNodeColorsBackup(data);
    const file = data.__fileNodeColors;
    const idxInfo = buildBaryNodeIndexInfo(data);
    const catPal = getCategoricalNodePalette();
    const nCat = catPal.length;
    const oneVsOne = baryCenterCategoricalNodeEncoding();
    const out = new Map();

    for (let i = 0; i < data.nodes.length; i++) {
      const node = data.nodes[i];
      const id = node.id;
      let base;
      if (oneVsOne) {
        // Use the same colormap family as lines, but assign independently by node index.
        // const idx = idxInfo.indexOf(id);
        // base = metroLineColor(selectedInputIdx);
        const idx = idxInfo.indexOf(id);
        base = PALETTE_23[idx % PALETTE_23.length];
        // Previous correspondence palette (kept for quick rollback):
        // const nTab = TAB20B_PALETTE.length;
        // base = TAB20B_PALETTE[idx % nTab];
      } else if (nodeColorScheme === "categorical") {
        const idx = idxInfo.indexOf(id);
        base = catPal[idx % nCat];
      } else {
        base = file.get(id) || node.color || "#808080";
      }
      const ov = _nodeColorOverrides.get(id);
      out.set(id, ov || base);
    }
    return out;
  }

  function applyBarycenterNodeDisplayColors(data) {
    if (!data || !data.nodes || !data.nodes.length) {
      _baryDisplayColorById = new Map();
      return;
    }
    const colorMap = computeBaryNodeDisplayColorMap(data);
    _baryDisplayColorById = colorMap;

    for (let i = 0; i < data.nodes.length; i++) {
      const n = data.nodes[i];
      const c = colorMap.get(n.id);
      if (c) n.color = c;
    }
    const bundles = data.bundles || [];
    for (let bi = 0; bi < bundles.length; bi++) {
      const mem = bundles[bi].members || [];
      for (let mi = 0; mi < mem.length; mi++) {
        const m = mem[mi];
        const c = colorMap.get(m.id);
        if (c) m.color = c;
      }
    }
  }

  // ── Rendering ────────────────────────────────────────────────────

  function render(d) {
    data = d;
    _substantialMatchNodeIds = computeSubstantialMatchNodeIdSet(data);
    refreshNodeColorOverridesForCurrentStem();
    refreshLineColorOverridesForCurrentStem();
    ensureLayoutSnapshot(data);
    restoreLayoutSnapshot(data);
    applyBarycenterYAxisSeparation(data);
    applyBarycenterEvenXDistribution(data);
    applyManualXSwaps(data);
    applyBarycenterNodeDisplayColors(data);
    const { nodeById, edgeLineSet, edgeMediatedLineSet,
      edgeSpecialChordLineSet, bundleById } =
      buildLookups(data);
    _edgeLineSet = edgeLineSet;
    _edgeMediatedLineSet = edgeMediatedLineSet;
    _edgeSpecialChordLineSet = edgeSpecialChordLineSet;
    // Precompute route popularity when every input is selected (bundled mode).
    _edgeFullRoutePop = data.edges.map((e, eidx) => {
      const mediated = _edgeMediatedLineSet[eidx];
      let cnt = 0;
      for (const lid of e.lines) {
        if (!mediated.has(lid)) cnt++;
      }
      return cnt;
    });
    _globalMaxRoutePopFull = Math.max(..._edgeFullRoutePop, 1);
    _nodeById = nodeById;
    _bundleById = bundleById;
    buildScales(data);

    const effectivePos = new Map();
    data.nodes.forEach(n => {
      if (isBaryNodeHiddenByFilter(n.id)) return;
      const bundle = bundleById.get(n.bundle);
      if (bundle && bundle.members.length > 1) {
        effectivePos.set(n.id, { x: bundle.cx, y: bundle.cy });
      } else {
        effectivePos.set(n.id, { x: n.x, y: n.y });
      }
    });
    _effectivePos = effectivePos;

    const uncertaintyInputs = getSelectionSet();
    const coordUnc = computeAllCoordUncertainties(data, uncertaintyInputs);
    const uncPack = computeActiveUncertaintyScale(data, uncertaintyInputs);

    const svg = d3.select("#metro-svg");
    svg.selectAll("*").remove();

    const zoom = d3.zoom()
      .scaleExtent([0.3, 10])
      .on("zoom", (event) => svgGroup.attr("transform", event.transform));
    svg.call(zoom);

    svgGroup = svg.append("g").attr("class", "metro-root");

    // ── Layer 0: Barycenter edges ──────────────────────────────
    const gEdges = svgGroup.append("g").attr("class", "edges");
    _gEdges = gEdges;
    renderEdges();

    // ── Layer 1: Stations / Bundles ─────────────────────────────
    const gStations = svgGroup.append("g").attr("class", "stations");
    _gStations = gStations;
    const renderedBundles = new Set();

    data.nodes.forEach(n => {
      if (isBaryNodeHiddenByFilter(n.id)) return;
      const bundle = bundleById.get(n.bundle);
      const isMulti = bundle && bundle.members.length > 1;

      if (isMulti) {
        if (renderedBundles.has(n.bundle)) return;
        const visibleMembers = bundle.members
          .map(m => +m.id)
          .filter(id => !isBaryNodeHiddenByFilter(id));
        if (!visibleMembers.length) return;
        renderedBundles.add(n.bundle);

        const cx = xScale(bundle.cx);
        const cy = yScale(bundle.cy);
        const r = nodeRadius(bundle.members.length);

        const gBundle = gStations.append("g")
          .attr("class", "station bundle")
          .attr("data-bundle-id", bundle.id)
          .attr("data-node-ids",
            visibleMembers.join(","))
          .attr("transform", `translate(${cx},${cy})`);

        const shownMembers = bundle.members.filter(m => visibleMembers.includes(+m.id));
        const nMembers = shownMembers.length;
        const angleStep = (2 * Math.PI) / nMembers;
        const catMode = baryCenterCategoricalNodeEncoding();
        const uncVar = functionUncertaintyActive(catMode);
        const bspec = bundleCoordUncertaintySpec(
          data, bundle, coordUnc.maxCoordDiff, uncertaintyInputs);
        const bundleDrawsEll = baryStationShowsCoordUncertaintyEllipse(bspec, r);
        const bundleWedgeFills = [];
        shownMembers.forEach((m, mi) => {
          const startAngle = mi * angleStep - Math.PI / 2;
          const endAngle = (mi + 1) * angleStep - Math.PI / 2;
          const arc = d3.arc()
            .innerRadius(0)
            .outerRadius(r)
            .startAngle(startAngle)
            .endAngle(endAngle);
          const wedgeFill = baryCoordUncDiskFill(
            bundleDrawsEll, catMode, m.color, uncVar);
          bundleWedgeFills.push(wedgeFill);
          gBundle.append("path")
            .attr("class", "station-wedge")
            .attr("data-member-id", m.id)
            .attr("d", arc())
            .attr("fill", wedgeFill)
            .attr("stroke", "#343a40")
            .attr("stroke-width", 0.5);
        });

        gBundle.append("circle")
          .attr("class", "station-outline-ring")
          .attr("r", r)
          .attr("fill", "none")
          .attr("stroke", "#343a40")
          .attr("stroke-width", CONFIG.stationStrokeWidth);

        const ids = shownMembers.map(m => m.id);
        const label = ids.length <= 3
          ? ids.join(",")
          : ids.slice(0, 2).join(",") + "..";
        const bundleLabelFills = bundleWedgeFills.slice();
        if (!catMode && bundleDrawsEll && uncVar) {
          const ms = meanMemberHeightStd(bundle, uncPack);
          const ellFill = stdToSequentialVariationFill(ms, uncPack.maxStd);
          insertCoordUncertaintyEllipse(gBundle, r, bspec, ellFill);
          bundleLabelFills.push(ellFill);
        }
        const bundleLabelFill = contrastLabelFillForFills(bundleLabelFills);
        gBundle.append("text")
          .attr("class", "station-label")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", CONFIG.labelFontSize)
          .attr("font-weight", "bold")
          .attr("fill", bundleLabelFill)
          .attr("pointer-events", "none")
          .text(label);

      } else {
        const cx = xScale(n.x);
        const cy = yScale(n.y);

        const gStation = gStations.append("g")
          .attr("class", "station singleton")
          .attr("data-node-id", n.id)
          .attr("data-node-ids", String(n.id))
          .attr("transform", `translate(${cx},${cy})`);

        const rSing = nodeRadius(1);
        const catMode = baryCenterCategoricalNodeEncoding();
        const uncVar = functionUncertaintyActive(catMode);
        const specN = coordUnc.byId.get(n.id);
        const drawsEll = baryStationShowsCoordUncertaintyEllipse(specN, rSing);
        const diskFill = baryCoordUncDiskFill(drawsEll, catMode, n.color, uncVar);
        gStation.append("circle")
          .attr("class", "station-std-disk")
          .attr("r", rSing)
          .attr("fill", diskFill)
          .attr("stroke", "none");

        gStation.append("circle")
          .attr("class", "station-outline-ring")
          .attr("r", rSing)
          .attr("fill", "none")
          .attr("stroke", "#343a40")
          .attr("stroke-width", CONFIG.stationStrokeWidth);

        const labelFills = [diskFill];
        if (!catMode && drawsEll && uncVar) {
          const ellFill = stdToSequentialVariationFill(
            uncPack.byId.get(n.id) || 0,
            uncPack.maxStd);
          insertCoordUncertaintyEllipse(gStation, rSing, specN, ellFill);
          labelFills.push(ellFill);
        }
        const labelColor = contrastLabelFillForFills(labelFills);
        gStation.append("text")
          .attr("class", "station-label")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", CONFIG.labelFontSize)
          .attr("font-weight", "bold")
          .attr("fill", labelColor)
          .attr("pointer-events", "none")
          .text(n.id);
      }
    });

    // ── Layer 2: Unpaired nodes + stub edges (optional overlay on barycenter) ─
    _gUnpaired = null;
    if (CONFIG.showUnpairedOverlayOnBarycenter &&
        data.unpairedNodes && data.unpairedNodes.length > 0) {
      const gUnpaired = svgGroup.append("g").attr("class", "unpaired-layer");
      _gUnpaired = gUnpaired;
    }
    if (_gUnpaired && data.unpairedNodes && data.unpairedNodes.length > 0) {
      const gUnpaired = _gUnpaired;
      const unpairedR = nodeRadius(1) * CONFIG.unpairedRadiusFactor;

      // Stub edges (drawn first, behind nodes)
      data.stubEdges.forEach(se => {
        if (isBaryNodeHiddenByFilter(se.anchorNode)) return;
        const anchor = effectivePos.get(se.anchorNode);
        const uNode = data.unpairedNodes.find(
          u => u.id === se.unpairedId);
        if (!anchor || !uNode) return;

        const ax = xScale(anchor.x), ay = yScale(anchor.y);
        const ux = xScale(uNode.x), uy = yScale(uNode.y);
        const lineColor = metroLineColor(data.lines[se.inputIdx]);

        gUnpaired.append("line")
          .attr("class", "stub-edge")
          .attr("x1", ax).attr("y1", ay)
          .attr("x2", ux).attr("y2", uy)
          .attr("stroke", lineColor)
          .attr("stroke-width", CONFIG.stubEdgeWidth)
          .attr("stroke-dasharray", CONFIG.stubEdgeDash)
          .attr("opacity", 0)
          .attr("data-input-idx", se.inputIdx);
      });

      // Unpaired node circles
      data.unpairedNodes.forEach(u => {
        if (isBaryNodeHiddenByFilter(u.anchorNode)) return;
        const cx = xScale(u.x);
        const cy = yScale(u.y);
        const lineColor = metroLineColor(data.lines[u.inputIdx]);

        const gU = gUnpaired.append("g")
          .attr("class", "unpaired-node")
          .attr("data-unpaired-id", u.id)
          .attr("data-input-idx", u.inputIdx)
          .attr("transform", `translate(${cx},${cy})`)
          .attr("opacity", 0);

        gU.append("circle")
          .attr("r", unpairedR)
          .attr("fill", lineColor)
          .attr("fill-opacity", 0.25)
          .attr("stroke", lineColor)
          .attr("stroke-width", CONFIG.unpairedStrokeWidth)
          .attr("stroke-dasharray", "3,2");

        gU.append("text")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", CONFIG.unpairedLabelFontSize)
          .attr("font-weight", "bold")
          .attr("fill", lineColor)
          .attr("pointer-events", "none")
          .text(u.inputNodeId);
      });
    }

    // ── Tooltip on stations ─────────────────────────────────────
    const tooltip = d3.select("#tooltip");

    gStations.selectAll(".station")
      .on("mouseenter", function (event) {
        const el = d3.select(this);
        const nodeIds = el.attr("data-node-ids").split(",").map(Number);
        tooltip.classed("input-tree-tip", false)
          .html(buildStationTooltip(nodeIds))
          .classed("visible", true);
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", (event.pageX + 14) + "px")
          .style("top", (event.pageY - 10) + "px");
      })
      .on("mouseleave", function () {
        tooltip.classed("input-tree-tip", false).classed("visible", false);
      })
      .on("click", function () {
        const el = d3.select(this);
        const nodeIds = el.attr("data-node-ids").split(",").map(Number);
        if (nodeIds.length <= 1) {
          _bundleCandidateIds = nodeIds;
          _selectedDetailNodeId = nodeIds[0];
          renderNodePanel();
        } else {
          _bundleCandidateIds = nodeIds;
          _selectedDetailNodeId = nodeIds[0];
          renderNodePanel();
        }
      });

    if (_gUnpaired) {
      _gUnpaired.selectAll(".unpaired-node")
        .on("mouseenter", function (event) {
          const el = d3.select(this);
          const uid = el.attr("data-unpaired-id");
          const u = data.unpairedNodes.find(n => n.id === uid);
          if (!u) return;
          const lineObj = data.lines[u.inputIdx];
          tooltip.classed("input-tree-tip", false).html(
            `<b>Unpaired node ${u.inputNodeId}</b><br>` +
            `From: <span style="color:${metroLineColor(lineObj)}">\u25CF</span> ` +
            `${lineObj.name}<br>` +
            `Height: ${u.height.toFixed(4)}<br>` +
            `Type: ${u.type}<br>` +
            `Anchor: station ${u.anchorNode}`
          ).classed("visible", true);
        })
        .on("mousemove", function (event) {
          tooltip
            .style("left", (event.pageX + 14) + "px")
            .style("top", (event.pageY - 10) + "px");
        })
        .on("mouseleave", function () {
          tooltip.classed("input-tree-tip", false).classed("visible", false);
        });
    }

    applySelection();
    renderNodePanel();
  }

  function shouldShowInputTreePanel() {
    return !!(data && !multiSelect && selectedLines.size === 1);
  }

  /**
   * Bundled bary map while the side input-tree panel is open (single line, multi off).
   * Edge thickness is not used to read stacked-input counts here — use a uniform width.
   */
  function bundledMapOneToOneCompareView() {
    return edgeMode === "bundled" && shouldShowInputTreePanel();
  }

  /** Bary vs single selected input: categorical node colors, no coord-uncertainty ellipse. */
  function baryCenterCategoricalNodeEncoding() {
    return shouldShowInputTreePanel();
  }

  /** Map halo for the open node-details panel: skip in single-input vs bary compare mode. */
  function mapStationDetailHighlightEnabled() {
    return !!(data && !baryCenterCategoricalNodeEncoding());
  }

  /**
   * Highlight the bary station (singleton or bundle) that matches {@link _selectedDetailNodeId}
   * when the node panel is expanded — only when {@link mapStationDetailHighlightEnabled} is true.
   * Inserts a circle **inside** the station radius, **above** disk/wedges but **below** the
   * coord-uncertainty ellipse (or below the outline ring if no ellipse).
   */
  function syncMapStationDetailHighlight() {
    if (!_gStations) return;
    _gStations.selectAll(".station-detail-highlight").remove();
    if (!mapStationDetailHighlightEnabled()) return;
    const panel = document.getElementById("node-panel");
    if (!panel || panel.classList.contains("collapsed")) return;
    const nid = _selectedDetailNodeId;
    if (nid === null || nid === undefined || !_nodeById || !_nodeById.has(nid)) return;

    let scale = CONFIG.mapStationDetailHighlightRadiusScale;
    if (!Number.isFinite(scale) || scale <= 0) scale = 0.94;
    scale = Math.min(scale, 1);
    const stroke = CONFIG.mapStationDetailHighlightStroke || "#868e96";
    const fill = CONFIG.mapStationDetailHighlightFill != null
      ? CONFIG.mapStationDetailHighlightFill
      : "rgba(108, 117, 125, 0.2)";
    const sw = Number.isFinite(CONFIG.mapStationDetailHighlightStrokeWidth)
      ? CONFIG.mapStationDetailHighlightStrokeWidth
      : 2;

    _gStations.selectAll(".station").each(function () {
      const g = d3.select(this);
      const nodeIdsStr = g.attr("data-node-ids");
      if (!nodeIdsStr) return;
      const ids = nodeIdsStr.split(",").map(Number);
      if (!ids.includes(nid)) return;
      const ring = g.select(".station-outline-ring");
      let rCore = nodeRadius(ids.length);
      if (!ring.empty()) {
        const rr = +ring.attr("r");
        if (Number.isFinite(rr) && rr > 0) rCore = rr;
      }
      const inset = sw > 0 ? sw * 0.5 : 0;
      const rH = Math.max(1, rCore * scale - inset);
      const beforeSel = g.select(".coord-uncertainty-ellipse").empty()
        ? ".station-outline-ring"
        : ".coord-uncertainty-ellipse";
      g.insert("circle", beforeSel)
        .attr("class", "station-detail-highlight")
        .attr("r", rH)
        .attr("cx", 0)
        .attr("cy", 0)
        .attr("fill", fill)
        .attr("stroke", stroke)
        .attr("stroke-width", sw)
        .attr("pointer-events", "none");
    });
  }

  /** Whether to draw the PCA coord-uncertainty ellipse on barycenter stations. */
  function baryStationShowsCoordUncertaintyEllipse(spec, rPx) {
    if (baryCenterCategoricalNodeEncoding()) return false;
    return specDrawsCoordEllipse(spec, rPx);
  }

  /**
   * Disk / wedge fill under coord-uncertainty encoding: neutral when an ellipse is drawn
   * (color lives in the ellipse); white when there are no matched field points (no ellipse).
   */
  function baryCoordUncDiskFill(drawsEllipse, catMode, baseNodeColor, uncVar) {
    if (catMode) return baseNodeColor;
    if (!uncVar) return baseNodeColor;
    return drawsEllipse
      ? (CONFIG.baryStationNeutralDiskFill || "#e9ecef")
      : "#ffffff";
  }

  /**
   * 2D position map `{ "nodeId": [x, y], ... }` for the input-tree panel.
   * Order: vizPos (contour layout from notebook) → coords → xs+ys → nodes[] with x,y.
   * Connectivities + xs/ys alone (no vizPos) are enough for orthogonal routing.
   */
  function extractInputTreePositionMap(tree) {
    const vp = tree.vizPos || tree.viz_pos;
    if (vp && typeof vp === "object" && Object.keys(vp).length) {
      return vp;
    }
    const coords = tree.coords;
    if (coords && typeof coords === "object") {
      const out = {};
      for (const k of Object.keys(coords)) {
        const c = coords[k];
        if (c && typeof c === "object" && "x" in c && "y" in c) {
          out[k] = [+c.x, +c.y];
        }
      }
      if (Object.keys(out).length) return out;
    }
    const xs = tree.xs || tree.x;
    const ys = tree.ys || tree.y;
    if (xs && ys && typeof xs === "object" && typeof ys === "object") {
      const out = {};
      const keys = new Set([...Object.keys(xs), ...Object.keys(ys)]);
      for (const k of keys) {
        if (xs[k] === undefined || ys[k] === undefined) continue;
        const xv = +xs[k];
        const yv = +ys[k];
        if (Number.isFinite(xv) && Number.isFinite(yv)) {
          out[k] = [xv, yv];
        }
      }
      if (Object.keys(out).length) return out;
    }
    const rawNodes = tree.nodes;
    if (Array.isArray(rawNodes) && rawNodes.length &&
        typeof rawNodes[0] === "object" && rawNodes[0] !== null) {
      const out = {};
      for (let i = 0; i < rawNodes.length; i++) {
        const n = rawNodes[i];
        if (!n || typeof n !== "object") continue;
        if (!("x" in n) || !("y" in n) || n.id === undefined) continue;
        out[String(n.id)] = [+n.x, +n.y];
      }
      if (Object.keys(out).length) return out;
    }
    return null;
  }

  /** Node ids: tree.nodes, every edge endpoint, and every vizPos key (sorted, unique). */
  function collectInputGraphNodeIds(tree) {
    const ids = new Set();
    const rawNodes = tree.nodes;
    if (Array.isArray(rawNodes)) {
      for (let i = 0; i < rawNodes.length; i++) {
        const item = rawNodes[i];
        const n = typeof item === "object" && item !== null && "id" in item
          ? +item.id
          : +item;
        if (!Number.isNaN(n)) ids.add(n);
      }
    }
    const edges = tree.edges || [];
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      let a;
      let b;
      if (Array.isArray(e) && e.length >= 2) {
        a = +e[0];
        b = +e[1];
      } else if (e && typeof e === "object") {
        a = +(e.source !== undefined ? e.source : e[0]);
        b = +(e.target !== undefined ? e.target : e[1]);
      } else {
        continue;
      }
      if (!Number.isNaN(a)) ids.add(a);
      if (!Number.isNaN(b)) ids.add(b);
    }
    const vp = extractInputTreePositionMap(tree);
    if (vp) {
      for (const k of Object.keys(vp)) {
        const n = +k;
        if (!Number.isNaN(n)) ids.add(n);
      }
    }
    return [...ids].sort((a, b) => a - b);
  }

  function normalizeInputEdge(e) {
    if (Array.isArray(e) && e.length >= 2) return [+e[0], +e[1]];
    if (e && typeof e === "object") {
      const a = +(e.source !== undefined ? e.source : e[0]);
      const b = +(e.target !== undefined ? e.target : e[1]);
      if (!Number.isNaN(a) && !Number.isNaN(b)) return [a, b];
    }
    return null;
  }

  /**
   * Orthogonal link from pa → pb in screen px. If |Δx| ≥ eps, first segment is horizontal
   * (then vertical). If |Δx| < eps and |Δy| ≥ eps, vertical only. Pure axis when one delta ~0.
   */
  function inputTreeEdgePathD(pa, pb) {
    const x1 = pa.x;
    const y1 = pa.y;
    const x2 = pb.x;
    const y2 = pb.y;
    const eps = 0.75;
    const adx = Math.abs(x2 - x1);
    const ady = Math.abs(y2 - y1);
    if (adx < eps && ady < eps) {
      return `M${x1},${y1}L${x2},${y2}`;
    }
    if (adx < eps) {
      return `M${x1},${y1}L${x1},${y2}`;
    }
    if (ady < eps) {
      return `M${x1},${y1}L${x2},${y1}`;
    }
    return `M${x1},${y1}L${x2},${y1}L${x2},${y2}`;
  }

  function orthoPathDFromScreenPoints(pa, pb) {
    return inputTreeEdgePathD(pa, pb);
  }

  /**
   * Map layout coords into viewBox; flip Y so larger scalar height is toward the top
   * (same convention as buildScales yScale). Skips nodes missing from vizPos instead of
   * failing the whole layout (strict tree.nodes order used to abort before).
   */
  function layoutTransformFromVizPos(vizPos, nodeIds, W, H, pad) {
    const pad2 = pad != null ? pad : 14;
    const raw = [];
    for (let i = 0; i < nodeIds.length; i++) {
      const id = nodeIds[i];
      const p = vizPos[String(id)] ?? vizPos[id];
      if (!Array.isArray(p) || p.length < 2) continue;
      raw.push({ id: +id, x: +p[0], y: +p[1] });
    }
    if (!raw.length) return null;
    const xs = raw.map(d => d.x);
    const ys = raw.map(d => d.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const dataW = xMax - xMin || 1;
    const dataH = yMax - yMin || 1;
    const innerW = W - 2 * pad2;
    const innerH = H - 2 * pad2;
    const s = Math.min(innerW / dataW, innerH / dataH);
    const ox = pad2 + (innerW - dataW * s) / 2;
    const oy = pad2 + (innerH - dataH * s) / 2;
    function mapLayoutToSvg(lx, ly) {
      return {
        x: ox + (lx - xMin) * s,
        y: oy + (yMax - ly) * s,
      };
    }
    const posById = new Map();
    for (let j = 0; j < raw.length; j++) {
      const d = raw[j];
      const m = mapLayoutToSvg(d.x, d.y);
      posById.set(d.id, { id: d.id, x: m.x, y: m.y });
    }
    return { posById, mapLayoutToSvg };
  }

  function readInputTreeScalarCoord(tree, nodeId, axis) {
    const sid = String(nodeId);
    const pl = tree[axis + "s"];
    if (pl && typeof pl === "object" && pl[sid] !== undefined) {
      const v = +pl[sid];
      return Number.isFinite(v) ? v : null;
    }
    const ps = tree[axis];
    if (ps && typeof ps === "object" && ps[sid] !== undefined) {
      const v = +ps[sid];
      return Number.isFinite(v) ? v : null;
    }
    const coords = tree.coords;
    if (coords && typeof coords === "object") {
      const c = coords[sid];
      if (c && typeof c === "object" && c[axis] !== undefined) {
        const v = +c[axis];
        return Number.isFinite(v) ? v : null;
      }
    }
    const rawNodes = tree.nodes;
    if (Array.isArray(rawNodes)) {
      for (let i = 0; i < rawNodes.length; i++) {
        const item = rawNodes[i];
        if (!item || typeof item !== "object") continue;
        const nid = item.id;
        if (String(nid) !== sid && nid !== nodeId) continue;
        if (item[axis] !== undefined) {
          const v = +item[axis];
          return Number.isFinite(v) ? v : null;
        }
        return null;
      }
    }
    return null;
  }

  function readInputTreeHeight(tree, nodeId) {
    const sid = String(nodeId);
    const h = tree.heights;
    if (h && h[sid] !== undefined) {
      const v = +h[sid];
      return Number.isFinite(v) ? v : null;
    }
    if (h && h[nodeId] !== undefined) {
      const v = +h[nodeId];
      return Number.isFinite(v) ? v : null;
    }
    return null;
  }

  function readInputTreeType(tree, nodeId) {
    const sid = String(nodeId);
    const t = tree.types;
    if (t && t[sid] !== undefined) {
      const v = +t[sid];
      return Number.isFinite(v) ? v : null;
    }
    if (t && t[nodeId] !== undefined) {
      const v = +t[nodeId];
      return Number.isFinite(v) ? v : null;
    }
    return null;
  }

  /**
   * All barycenter nodes that list this input node for inputIdx (with coupling mass).
   */
  function collectBaryMatchesForInputNode(data, inputIdx, inputNodeId) {
    const nmi = data && data.nodeMatchIndex;
    if (!nmi) return [];
    const out = [];
    const sKey = String(inputIdx);
    const keys = Object.keys(nmi);
    for (let i = 0; i < keys.length; i++) {
      const baryKey = keys[i];
      const entry = nmi[baryKey];
      const arr = entry && entry.byInput && entry.byInput[sKey];
      if (!Array.isArray(arr)) continue;
      for (let j = 0; j < arr.length; j++) {
        const r = arr[j];
        if (r && +r.inputNodeId === +inputNodeId) {
          out.push({ baryId: +baryKey, mass: Number(r.mass) });
          break;
        }
      }
    }
    out.sort((a, b) => b.mass - a.mass);
    return out;
  }

  function buildInputTreeNodeTooltipHtml(tree, data, inputIdx, nodeId) {
    const xv = readInputTreeScalarCoord(tree, nodeId, "x");
    const yv = readInputTreeScalarCoord(tree, nodeId, "y");
    const zv = readInputTreeScalarCoord(tree, nodeId, "z");
    const hVal = readInputTreeHeight(tree, nodeId);
    const tVal = readInputTreeType(tree, nodeId);

    const vp = tree.vizPos || tree.viz_pos;
    let vx = null;
    let vy = null;
    if (vp && typeof vp === "object") {
      const arr = vp[String(nodeId)] ?? vp[nodeId];
      if (Array.isArray(arr) && arr.length >= 2) {
        vx = +arr[0];
        vy = +arr[1];
        if (!Number.isFinite(vx)) vx = null;
        if (!Number.isFinite(vy)) vy = null;
      }
    }

    const matches = collectBaryMatchesForInputNode(data, inputIdx, nodeId);
    const nmi = data && data.nodeMatchIndex;

    let typeName = "\u2014";
    if (tVal !== null && !Number.isNaN(tVal)) {
      if (tVal === 0) typeName = "min";
      else if (tVal === 2) typeName = "max";
      else typeName = "saddle";
    }

    const fmt = v =>
      v === null || v === undefined || Number.isNaN(v)
        ? "\u2014"
        : Number(v).toFixed(4);

    const lines = [];
    lines.push(`<b>Input node ${nodeId}</b>`);
    lines.push(
      `Scalar height: ${
        hVal == null ? "\u2014" : Number(hVal).toFixed(6)}`);
    lines.push(`Type: ${typeName}`);

    const coordBits = [];
    if (xv !== null) coordBits.push(`x=${fmt(xv)}`);
    if (yv !== null) coordBits.push(`y=${fmt(yv)}`);
    if (zv !== null) coordBits.push(`z=${fmt(zv)}`);
    lines.push(
      coordBits.length
        ? `Spatial coords: ${coordBits.join(", ")}`
        : "Spatial coords: \u2014");

    if (vx !== null && vy !== null) {
      lines.push(`Layout (viz): x=${fmt(vx)}, y=${fmt(vy)}`);
    }

    if (matches.length) {
      const parts = matches.map(
        m => `node ${m.baryId} (${(100 * m.mass).toFixed(1)}%)`
      );
      lines.push(`Barycenter match(es): ${parts.join("; ")}`);
    } else if (nmi) {
      lines.push("Barycenter (primary OT): None");
    } else {
      lines.push(
        "Barycenter: \u2014 (run prepare_data.py and reload for match data)"
      );
    }

    return lines.join("<br>");
  }

  /** SVG path d for a polyline in layout space (orthogonal H/V segments). */
  function inputTreePolylinePathD(seg, mapLayoutToSvg) {
    if (!seg || !seg.length || !mapLayoutToSvg) return "";
    const pts = [];
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      if (!Array.isArray(p) || p.length < 2) return "";
      pts.push(mapLayoutToSvg(+p[0], +p[1]));
    }
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let k = 1; k < pts.length; k++) {
      d += `L${pts[k].x},${pts[k].y}`;
    }
    return d;
  }

  function drawInputTreeSvg(tree, inputIdx) {
    const svg = d3.select("#input-tree-svg");
    const svgEl = document.getElementById("input-tree-svg");
    const panel = document.getElementById("input-tree-panel");
    if (!svg.size() || !svgEl || !panel || !data) return;
    svg.selectAll("*").remove();
    const unpairedIds = new Set(
      (data.unpairedNodes || [])
        .filter(u => u.inputIdx === inputIdx)
        .map(u => +u.inputNodeId)
    );
    const graphNodeIds = collectInputGraphNodeIds(tree);
    if (!graphNodeIds.length) return;
    /** No row in nodeMatchIndex with coupling mass for this input line (tooltip "primary OT: None"). */
    const noCouplingIds = new Set();
    const nmi = data.nodeMatchIndex;
    if (nmi) {
      for (let gi = 0; gi < graphNodeIds.length; gi++) {
        const nid = +graphNodeIds[gi];
        if (!Number.isFinite(nid)) continue;
        const m = collectBaryMatchesForInputNode(data, inputIdx, nid);
        if (!m.length) noCouplingIds.add(nid);
      }
    }
    function inputTreeNodeDimmed(nid) {
      return unpairedIds.has(+nid) || noCouplingIds.has(+nid);
    }
    const idSet = new Set(graphNodeIds);
    const rawEdges = tree.edges || [];
    const W = Math.max(280, svgEl.clientWidth || 320);
    const H = Math.max(200, (panel.clientHeight - 52) || 260);
    svg.attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "xMidYMid meet");

    /** One-to-one compare: slightly smaller than barycenter singleton (80% of map radius). */
    const inputNodeR = nodeRadius(1) * 0.8;
    const inputTreeLayoutPad = Math.max(16, inputNodeR + 8);

    let vizPos = extractInputTreePositionMap(tree);
    const vizPosOrig = vizPos ? cloneVizPosMap(vizPos) : null;
    if (vizPos) {
      vizPos = applyInputTreeYAxisSeparation(tree, graphNodeIds, vizPos, W, H);
    }
    let vizSegs = tree.vizEdgeSegments || tree.viz_edge_segments;
    const vizSegNodeIds = tree.vizSegmentNodeIds || tree.viz_segment_node_ids;
    if (CONFIG.yAxisSeparationEnabled && vizSegs && vizPosOrig && vizPos) {
      vizSegs = adjustVizEdgeSegmentsY(vizSegs, vizSegNodeIds, vizPosOrig, vizPos);
    }
    let posById = null;
    let mapLayoutToSvg = null;
    if (vizPos) {
      const tf = layoutTransformFromVizPos(
        vizPos, graphNodeIds, W, H, inputTreeLayoutPad);
      if (tf) {
        posById = tf.posById;
        mapLayoutToSvg = tf.mapLayoutToSvg;
      }
    }

    if (!posById) {
      const nodeList = graphNodeIds.map(id => ({ id }));
      const links = [];
      for (let i = 0; i < rawEdges.length; i++) {
        const ends = normalizeInputEdge(rawEdges[i]);
        if (!ends) continue;
        const a = ends[0];
        const b = ends[1];
        if (idSet.has(a) && idSet.has(b)) {
          links.push({ source: a, target: b });
        }
      }
      const sim = d3.forceSimulation(nodeList)
        .force("link", d3.forceLink(links).id(d => d.id).distance(32))
        .force("charge", d3.forceManyBody().strength(-140))
        .force("center", d3.forceCenter(W / 2, H / 2));
      sim.stop();
      for (let t = 0; t < 450; t++) sim.tick();
      posById = new Map(nodeList.map(n => [n.id, n]));
    }

    const nodeList = graphNodeIds.map(id => posById.get(id)).filter(Boolean);
    const inputBranchLookup = buildInputTreeBranchLookup(tree);

    const orthoPaths = [];
    let usedExportedSegments = false;
    if (
      mapLayoutToSvg &&
      Array.isArray(vizSegs) &&
      vizSegs.length > 0 &&
      Array.isArray(vizSegNodeIds) &&
      vizSegNodeIds.length === vizSegs.length
    ) {
      for (let si = 0; si < vizSegs.length; si++) {
        const seg = vizSegs[si];
        const nidRow = vizSegNodeIds[si] || [];
        // Use notebook-exported polyline (contour_tree_layout); do not replace with synthetic L.
        const pathD = inputTreePolylinePathD(seg, mapLayoutToSvg);
        if (!pathD) continue;
        const dim = nidRow.some(nid => inputTreeNodeDimmed(+nid));
        orthoPaths.push({ pathD, dim });
      }
      if (orthoPaths.length === vizSegs.length) {
        usedExportedSegments = true;
      } else {
        orthoPaths.length = 0;
      }
    }

    if (!usedExportedSegments) {
      orthoPaths.length = 0;
      for (let i = 0; i < rawEdges.length; i++) {
        const ends = normalizeInputEdge(rawEdges[i]);
        if (!ends) continue;
        const a = ends[0];
        const b = ends[1];
        if (!idSet.has(a) || !idSet.has(b)) continue;
        const [fromId, toId] = inputTreeDrawOrderedEndpoints(tree, inputBranchLookup, a, b);
        const pa = posById.get(fromId);
        const pb = posById.get(toId);
        if (!pa || !pb) continue;
        const pathD = inputTreeEdgePathD(pa, pb);
        orthoPaths.push({
          pathD,
          dim: inputTreeNodeDimmed(fromId) || inputTreeNodeDimmed(toId),
        });
      }
    }

    const g = svg.append("g").attr("class", "input-tree-graph");
    const lineFallback = metroLineColor(data.lines[inputIdx]);
    const primMaps = data.inputPrimaryBarycenter;
    const primForInput =
      primMaps && primMaps[inputIdx] && typeof primMaps[inputIdx] === "object"
        ? primMaps[inputIdx]
        : null;

    function inputTreeNodeFill(graphNodeId) {
      if (!primForInput || !_baryDisplayColorById || !_baryDisplayColorById.size) {
        return lineFallback;
      }
      const k = String(graphNodeId);
      const baryId = primForInput[k] !== undefined ? primForInput[k] : primForInput[graphNodeId];
      if (baryId === undefined || baryId === null) return lineFallback;
      return _baryDisplayColorById.get(baryId) || lineFallback;
    }

    /** Unpaired or no coupling mass in nodeMatchIndex: neutral gray, de-emphasized. */
    const inputTreeDimmedFill = "#ced4da";
    const inputTreeDimmedStroke = "#868e96";

    /** Bundled + one-line compare: fixed link weight (not degree / multiplex). */
    const inputTreeLinkStroke = bundledMapOneToOneCompareView() ? 2.2 : 1.25;

    g.selectAll("path.input-tree-link")
      .data(orthoPaths)
      .join("path")
      .attr("class", "input-tree-link")
      .attr("d", d => d.pathD)
      .attr("fill", "none")
      .attr("stroke", "#adb5bd")
      .attr("stroke-width", inputTreeLinkStroke)
      .attr("stroke-linejoin", "round")
      .attr("stroke-linecap", "round")
      .attr("opacity", d => {
        const dimOp = Number.isFinite(CONFIG.inputTreeDimmedElementOpacity)
          ? CONFIG.inputTreeDimmedElementOpacity
          : 0.3;
        return d.dim ? dimOp : 0.9;
      });

    const inputTreeTooltip = d3.select("#tooltip");
    g.selectAll("circle.input-tree-node")
      .data(nodeList)
      .join("circle")
      .attr("class", d =>
        "input-tree-node" + (inputTreeNodeDimmed(d.id) ? " input-tree-node--dimmed" : ""))
      .attr("r", inputNodeR)
      .attr("cx", d => d.x)
      .attr("cy", d => d.y)
      .attr("fill", d => (inputTreeNodeDimmed(d.id)
        ? inputTreeDimmedFill
        : inputTreeNodeFill(d.id)))
      .attr("stroke", d => (inputTreeNodeDimmed(d.id)
        ? inputTreeDimmedStroke
        : "#343a40"))
      .attr("stroke-width", CONFIG.stationStrokeWidth)
      .attr("opacity", d => {
        if (!inputTreeNodeDimmed(d.id)) return 1;
        const dimOp = Number.isFinite(CONFIG.inputTreeDimmedElementOpacity)
          ? CONFIG.inputTreeDimmedElementOpacity
          : 0.3;
        return dimOp;
      })
      .on("mouseenter", function (event, d) {
        inputTreeTooltip
          .classed("input-tree-tip", true)
          .html(buildInputTreeNodeTooltipHtml(tree, data, inputIdx, d.id))
          .classed("visible", true);
      })
      .on("mousemove", function (event) {
        inputTreeTooltip
          .style("left", (event.pageX + 12) + "px")
          .style("top", (event.pageY - 8) + "px");
      })
      .on("mouseleave", function () {
        inputTreeTooltip
          .classed("input-tree-tip", false)
          .classed("visible", false);
      });

    g.selectAll("text.input-tree-label")
      .data(nodeList)
      .join("text")
      .attr("class", "input-tree-label")
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("font-size", CONFIG.labelFontSize)
      .attr("fill", d => {
        if (inputTreeNodeDimmed(d.id)) return "#343a40";
        const fc = inputTreeNodeFill(d.id);
        return isLightColor(fc) ? "#343a40" : "#fff";
      })
      .attr("opacity", d => {
        if (!inputTreeNodeDimmed(d.id)) return 1;
        const dimOp = Number.isFinite(CONFIG.inputTreeDimmedElementOpacity)
          ? CONFIG.inputTreeDimmedElementOpacity
          : 0.3;
        return dimOp;
      })
      .attr("pointer-events", "none")
      .text(d => d.id);
  }

  function ensureInputTreeResizeObserver() {
    const panel = document.getElementById("input-tree-panel");
    if (!panel || _inputTreeResizeObserver || typeof ResizeObserver === "undefined") {
      return;
    }
    _inputTreeResizeObserver = new ResizeObserver(() => {
      if (_lastInputTreePayload && shouldShowInputTreePanel()) {
        drawInputTreeSvg(_lastInputTreePayload.tree, _lastInputTreePayload.inputIdx);
      }
    });
    _inputTreeResizeObserver.observe(panel);
  }

  function syncInputTreeHint() {
    const hint = document.getElementById("input-tree-hint");
    if (!hint || !data) return;
    if (!multiSelect && isAllSelected()) {
      hint.textContent =
        "Tip: With Multi off, click a single line in the legend to open the source tree panel " +
        "(orthogonal layout).";
    } else {
      hint.textContent = "";
    }
  }

  /**
   * Fetch input tree JSON for the current dataset stem. Tries
   *   data/input_trees/<stem>/tree_XX.json
   * then legacy flat data/input_trees/tree_XX.json.
   */
  async function fetchInputTreeJsonForCurrentDataset(inputIdx) {
    const file = `tree_${String(inputIdx).padStart(2, "0")}.json`;
    const stem = getCurrentDatasetStem();
    const paths = [];
    if (stem) {
      paths.push(`data/input_trees/${encodeURIComponent(stem)}/${file}`);
    }
    paths.push(`data/input_trees/${file}`);
    let lastStatus = 0;
    for (let i = 0; i < paths.length; i++) {
      const resp = await fetch(dataUrl(paths[i]), { cache: "no-store" });
      if (resp.ok) return await resp.json();
      lastStatus = resp.status;
    }
    throw new Error(`HTTP ${lastStatus || "unknown"}`);
  }

  async function updateInputTreePanel() {
    const panel = document.getElementById("input-tree-panel");
    const msgEl = document.getElementById("input-tree-message");
    const header = document.getElementById("input-tree-header");
    if (!panel || !data) return;
    if (!shouldShowInputTreePanel()) {
      panel.classList.remove("visible");
      panel.setAttribute("aria-hidden", "true");
      if (msgEl) msgEl.textContent = "";
      return;
    }
    const inputIdx = [...selectedLines][0];
    if (header) {
      header.textContent = `Input ${inputIdx} (source tree)`;
    }
    panel.classList.add("visible");
    panel.setAttribute("aria-hidden", "false");
    if (msgEl) msgEl.textContent = "Loading…";
    try {
      const tree = await fetchInputTreeJsonForCurrentDataset(inputIdx);
      if (msgEl) msgEl.textContent = "";
      _lastInputTreePayload = { tree, inputIdx };
      drawInputTreeSvg(tree, inputIdx);
      ensureInputTreeResizeObserver();
      requestAnimationFrame(() => {
        if (_lastInputTreePayload && shouldShowInputTreePanel()) {
          drawInputTreeSvg(_lastInputTreePayload.tree, _lastInputTreePayload.inputIdx);
        }
      });
    } catch (err) {
      _lastInputTreePayload = null;
      if (msgEl) {
        msgEl.textContent =
          "Could not load input tree. Run prepare_data.py for this dataset so " +
          "metro_viz/data/input_trees/<dataset>/ exists (or legacy flat input_trees/).";
      }
    }
  }

  function typeClassOrderForBarySoftTypes() {
    const m = data && data.meta && data.meta.typeClassOrder;
    return Array.isArray(m) ? m : null;
  }

  function contourTypeShortLabel(t) {
    const n = +t;
    if (n === 0) return "min";
    if (n === 1) return "saddle";
    if (n === 2) return "max";
    if (n === 3) return "type 3";
    return `type ${t}`;
  }

  /**
   * Rich HTML for FGW soft type on a barycenter node: prefers typeMass, else
   * normalizes nonnegative typeFeatures. Entries align with data.meta.typeClassOrder
   * when present (from export metadata unique_types).
   * @param {"tooltip"|"panel"} theme
   */
  function barySoftTypeDistributionHtml(nd, theme) {
    if (!nd) return "";
    const panel = theme === "panel";
    const order = typeClassOrderForBarySoftTypes();
    let masses = nd.typeMass;
    if (!Array.isArray(masses) || !masses.length) {
      const fv = nd.typeFeatures;
      if (!Array.isArray(fv) || !fv.length) return "";
      const pos = fv.map(x => Math.max(0, +x));
      const s = pos.reduce((a, b) => a + b, 0);
      if (s <= 1e-15) return "";
      masses = pos.map(x => x / s);
    }
    const n = masses.length;
    if (!n) return "";
    const pairs = [];
    for (let i = 0; i < n; i++) {
      const lab = order && i < order.length ? order[i] : i;
      pairs.push({ lab, m: Math.max(0, +masses[i]) || 0 });
    }
    pairs.sort((a, b) => b.m - a.m);
    const rows = pairs.map(p =>
      `${contourTypeShortLabel(p.lab)}: ${(100 * p.m).toFixed(1)}%`);
    const borderTop = panel ? "#e9ecef" : "rgba(255,255,255,0.2)";
    const titleStyle = panel
      ? "font-size:10px;font-weight:600;color:#868e96;text-transform:uppercase;" +
        "letter-spacing:0.03em;margin-bottom:4px;"
      : "font-size:10px;font-weight:600;opacity:0.85;text-transform:uppercase;" +
        "letter-spacing:0.03em;margin-bottom:4px;";
    const bodyStyle = panel
      ? "font-size:11px;line-height:1.45;color:#343a40;"
      : "font-size:11px;line-height:1.45;";
    return (
      `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${borderTop};">` +
      `<div style="${titleStyle}">Type mix (FGW)</div>` +
      `<div style="${bodyStyle}">${rows.join("<br>")}</div>` +
      `</div>`
    );
  }

  function buildStationTooltip(nodeIds) {
    if (nodeIds.length === 1) {
      const nd = _nodeById.get(nodeIds[0]);
      const soft = barySoftTypeDistributionHtml(nd, "tooltip");
      return `<b>Station ${nd.id}</b><br>` +
        `Height: ${nd.height.toFixed(4)}<br>` +
        `Type (argmax): ${nd.type}<br>` +
        `Lines: ${nd.numLines}` +
        (soft ? `<br>${soft}` : "");
    }
    let html = `<b>Bundle (${nodeIds.length} nodes)</b><br>`;
    nodeIds.forEach(nid => {
      const nd = _nodeById.get(nid);
      html += `<hr style="margin:4px 0">`;
      html +=
        `<span style="color:${nd.color}">\u25CF</span> ` +
        `<b>Node ${nd.id}</b> ` +
        `h=${nd.height.toFixed(4)}, type=${nd.type}, ` +
        `lines=${nd.numLines}<br>`;
      const soft = barySoftTypeDistributionHtml(nd, "tooltip");
      if (soft) html += soft;
    });
    return html;
  }

  // ── Line palette (must match prepare_data.py) ───────────────────
  // 23 line colors: ColorBrewer-style qualitative (Paired w/o orange + Dark2 + Set2); no orange.
  // Slot 2: light sky blue #6abaec; slot 3: burgundy (CVD-friendly vs strong primaries).
  // Must match prepare_data.py PALETTE_23.
  const PALETTE_23 = [
    "#1f78b4", "#eaea9a", "#6abaec", "#7a1e48", "#cab2d6",
    "#b15928", "#1b9e77", "#666666", "#8da0cb", "#e7298a",
    "#66a61e", "#8dd3c7", "#fb9a99", "#6a3d9a", "#ccebc5",
    "#66c2a5", "#ffd92f", "#7570b3", "#b2df8a", "#e78ac3",
    "#a6d854", "#e5c494", "#b3b3b3",
  ];

  /** Line / input color from `line.id` (overrides, else PALETTE_23; same as prepare_data). */
  function metroLineColor(lineOrId) {
    let id;
    if (lineOrId != null && typeof lineOrId === "object" && "id" in lineOrId) {
      id = +lineOrId.id;
    } else {
      id = +lineOrId;
    }
    if (!Number.isFinite(id) || id < 0) id = 0;
    const ov = _lineColorOverrides.get(id);
    if (ov) return ov;
    return PALETTE_23[id % PALETTE_23.length];
  }

  /** Matplotlib `tab20b` (20 discrete categories) for bary vs single-input (1v1) node coloring. */
  const TAB20B_PALETTE = [
    "#393b79", "#5254a3", "#6b6ecf", "#9c9ede",
    "#637939", "#8ca252", "#b5cf6b", "#cedb9c",
    "#8c6d31", "#bd9e39", "#e7ba52", "#e7cb94",
    "#843c39", "#ad494a", "#d6616b", "#e7969c",
    "#7b4173", "#a55194", "#ce6dbd", "#de9ed6",
  ];

  let _categoricalNodePaletteCache = null;

  /**
   * Large discrete palette for barycenter *node* categorical mode only.
   * Do not prepend PALETTE_23 (metro line colors): many are light on white and wash out stations.
   */
  function getCategoricalNodePalette() {
    if (_categoricalNodePaletteCache) return _categoricalNodePaletteCache;
    const seen = new Set();
    const out = [];
    function add(c) {
      if (!c || typeof c !== "string" || seen.has(c)) return;
      seen.add(c);
      out.push(c);
    }
    const schemes = [
      d3.schemeCategory10,
      d3.schemeDark2,
      d3.schemePaired,
      d3.schemeSet1,
      d3.schemeSet2,
      d3.schemeSet3,
      d3.schemePastel1,
      d3.schemePastel2,
      d3.schemeAccent,
      d3.schemeTableau10,
      d3.schemeObservable10,
    ];
    for (let si = 0; si < schemes.length; si++) {
      const s = schemes[si];
      if (Array.isArray(s)) s.forEach(add);
    }
    _categoricalNodePaletteCache = out.length ? out : ["#888888"];
    return _categoricalNodePaletteCache;
  }

  // Contour node types (see lib/contour_tree_visualization._node_type): min, saddle, max.
  const CONTOUR_MIN = 0;
  const CONTOUR_SADDLE = 1;
  const CONTOUR_MAX = 2;

  function normalizeContourNodeType(t) {
    const n = Number(t);
    if (n === CONTOUR_MIN) return CONTOUR_MIN;
    if (n === CONTOUR_MAX) return CONTOUR_MAX;
    return CONTOUR_SADDLE;
  }

  /**
   * Barycenter edges from prepare_data use source=min(id), target=max(id). When an edge is a
   * consecutive pair on a branch from branches.pkl, the only correct draw direction is along
   * that branch list: nodes[i] → nodes[i+1] (notebook / contour_tree_layout order). This fixes
   * saddle–saddle trunk edges where height-only heuristics pick the wrong start.
   */
  function barycenterBranchOrderedEndpoints(e) {
    if (!data || !data.branches || e.branch == null || e.branch < 0) return null;
    const br = data.branches[e.branch];
    if (!br || !Array.isArray(br.nodes)) return null;
    const nodes = br.nodes;
    const ia = nodes.indexOf(e.source);
    const ib = nodes.indexOf(e.target);
    if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1) return null;
    const lo = Math.min(ia, ib);
    return [nodes[lo], nodes[lo + 1]];
  }

  /**
   * Fallback when branch order does not apply: saddle → extremum; min–max by height;
   * remaining pairs by height (avoids relying on min/max node ids).
   */
  function contourOrderedEdgeEndpoints(a, b, getType, getHeight) {
    const ta = normalizeContourNodeType(getType(a));
    const tb = normalizeContourNodeType(getType(b));
    const ha = +getHeight(a);
    const hb = +getHeight(b);
    const isMin = t => t === CONTOUR_MIN;
    const isMax = t => t === CONTOUR_MAX;
    const isSaddle = t => t === CONTOUR_SADDLE;

    if ((isMin(ta) && isMax(tb)) || (isMax(ta) && isMin(tb))) {
      return ha >= hb ? [a, b] : [b, a];
    }
    if (isSaddle(ta) && (isMin(tb) || isMax(tb))) return [a, b];
    if (isSaddle(tb) && (isMin(ta) || isMax(ta))) return [b, a];
    return ha >= hb ? [a, b] : [b, a];
  }

  function inputTreeTypeHeight(tree, id) {
    const types = tree.types || {};
    const heights = tree.heights || {};
    const k = String(id);
    let tv = types[k];
    if (tv === undefined) tv = types[id];
    let hv = heights[k];
    if (hv === undefined) hv = heights[id];
    return {
      type: tv !== undefined ? +tv : CONTOUR_SADDLE,
      height: hv !== undefined ? +hv : 0,
    };
  }

  function inputTreeOrderedEndpoints(tree, a, b) {
    return contourOrderedEdgeEndpoints(a, b,
      id => inputTreeTypeHeight(tree, id).type,
      id => inputTreeTypeHeight(tree, id).height);
  }

  /** Same edge→branch idea as prepare_data + barycenterBranchOrderedEndpoints. */
  function buildInputTreeBranchLookup(tree) {
    const branches = tree.branches;
    if (!Array.isArray(branches) || branches.length === 0) return null;
    const lookup = new Map();
    for (let bi = 0; bi < branches.length; bi++) {
      const nodes = branches[bi].nodes;
      if (!Array.isArray(nodes)) continue;
      for (let i = 0; i < nodes.length - 1; i++) {
        const u = +nodes[i];
        const v = +nodes[i + 1];
        const lo = Math.min(u, v);
        const hi = Math.max(u, v);
        lookup.set(`${lo},${hi}`, { bi, i });
      }
    }
    return { branches, lookup };
  }

  function inputTreeBranchOrderedEndpoints(lookupPack, a, b) {
    if (!lookupPack) return null;
    const lo = Math.min(+a, +b);
    const hi = Math.max(+a, +b);
    const info = lookupPack.lookup.get(`${lo},${hi}`);
    if (!info) return null;
    const nodes = lookupPack.branches[info.bi].nodes;
    const ia = nodes.indexOf(+a);
    const ib = nodes.indexOf(+b);
    if (ia < 0 || ib < 0 || Math.abs(ia - ib) !== 1) return null;
    const idxLo = Math.min(ia, ib);
    return [nodes[idxLo], nodes[idxLo + 1]];
  }

  function inputTreeDrawOrderedEndpoints(tree, branchLookup, a, b) {
    const br = inputTreeBranchOrderedEndpoints(branchLookup, a, b);
    if (br) return br;
    return inputTreeOrderedEndpoints(tree, a, b);
  }

  // ── Edge rendering ──────────────────────────────────────────────

  function renderEdges() {
    if (!_gEdges || !data) return;
    _gEdges.selectAll("*").remove();
    if (edgeMode === "metro") {
      const noSel = selectedLines.size === 0;
      const allSel = isAllSelected();
      const baseSel = (allSel || noSel)
        ? new Set(data.lines.map(l => l.id))
        : new Set(selectedLines);
      const selectionSet = new Set(baseSel);
      // Include the hovered line so highlightLine() can show it even
      // when it isn't part of the current selection.
      if (highlightedLine !== null) selectionSet.add(highlightedLine);
      const selCountForWidth = Math.max(1, baseSel.size);
      renderEdgesMetro(selectionSet, selCountForWidth);
    } else {
      renderEdgesBundled();
    }
    bindEdgeHoverTooltip();
  }

  /** Orthogonal edge in screen px: "L" = horizontal then vertical; "straight" = segment. */
  function orthoEdgePathD(ep) {
    if (ep.type === "straight") {
      return `M${ep.x1},${ep.y1}L${ep.x2},${ep.y2}`;
    }
    return `M${ep.sx},${ep.sy}L${ep.cx},${ep.sy}L${ep.cx},${ep.cy}`;
  }

  function edgePath(e, eidx) {
    const na = _nodeById.get(e.source);
    const nb = _nodeById.get(e.target);
    if (!na || !nb) return null;
    const brOrd = barycenterBranchOrderedEndpoints(e);
    const [fromId, toId] = brOrd || contourOrderedEdgeEndpoints(e.source, e.target,
      id => _nodeById.get(id).type,
      id => _nodeById.get(id).height);
    const sp = _effectivePos.get(fromId);
    const tp = _effectivePos.get(toId);
    if (!sp || !tp) return null;
    const x1 = xScale(sp.x), y1 = yScale(sp.y);
    const x2 = xScale(tp.x), y2 = yScale(tp.y);
    const eps = 0.75;
    const adx = Math.abs(x2 - x1);
    const ady = Math.abs(y2 - y1);
    if (adx < eps && ady < eps) {
      return { type: "straight", x1, y1, x2, y2 };
    }
    if (adx < eps) {
      return { type: "straight", x1, y1, x2: x1, y2 };
    }
    if (ady < eps) {
      return { type: "straight", x1, y1, x2, y2: y1 };
    }
    return { type: "L", sx: x1, sy: y1, cx: x2, cy: y2 };
  }

  /** Metro stripe path with perpendicular offset (same as per-line stripes). */
  function metroStripePathFromEp(ep, offset) {
    if (ep.type === "L") {
      return `M${ep.sx},${ep.sy + offset}` +
        `L${ep.cx + offset},${ep.sy + offset}` +
        `L${ep.cx + offset},${ep.cy}`;
    }
    const dx = ep.x2 - ep.x1, dy = ep.y2 - ep.y1;
    // Use a direction-independent normal so stripe order does not flip
    // when adjacent edges are oriented in opposite draw directions.
    let nx = 0;
    let ny = 0;
    if (Math.abs(dx) <= Math.abs(dy)) {
      nx = 1;
      ny = 0;
    } else {
      nx = 0;
      ny = 1;
    }
    const ox = offset * nx, oy = offset * ny;
    return `M${ep.x1 + ox},${ep.y1 + oy}` +
      `L${ep.x2 + ox},${ep.y2 + oy}`;
  }

  /** Screen-space segments of the offset metro stripe polyline (same geometry as stripes). */
  function metroStripeSegmentsFromEp(ep, offset) {
    const segs = [];
    if (ep.type === "L") {
      segs.push({
        x1: ep.sx, y1: ep.sy + offset,
        x2: ep.cx + offset, y2: ep.sy + offset
      });
      segs.push({
        x1: ep.cx + offset, y1: ep.sy + offset,
        x2: ep.cx + offset, y2: ep.cy
      });
    } else {
      const dx = ep.x2 - ep.x1, dy = ep.y2 - ep.y1;
      // Match metroStripePathFromEp: orientation-invariant normal.
      let nx = 0;
      let ny = 0;
      if (Math.abs(dx) <= Math.abs(dy)) {
        nx = 1;
        ny = 0;
      } else {
        nx = 0;
        ny = 1;
      }
      const ox = offset * nx, oy = offset * ny;
      segs.push({
        x1: ep.x1 + ox, y1: ep.y1 + oy,
        x2: ep.x2 + ox, y2: ep.y2 + oy
      });
    }
    return segs;
  }

  /** Orthogonal spine segments (screen px) for bundled-style paths / underlays. */
  function orthoSpineSegmentsFromEp(ep) {
    const segs = [];
    if (ep.type === "L") {
      segs.push({ x1: ep.sx, y1: ep.sy, x2: ep.cx, y2: ep.sy });
      segs.push({ x1: ep.cx, y1: ep.sy, x2: ep.cx, y2: ep.cy });
    } else {
      segs.push({ x1: ep.x1, y1: ep.y1, x2: ep.x2, y2: ep.y2 });
    }
    return segs;
  }

  /**
   * Perpendicular strike ticks along polyline segments (pointer-events none).
   */
  function appendStrikeTicksOnSegments(gParent, segments, tickLen, spacing, stroke, sw) {
    if (!segments.length || tickLen <= 0 || spacing <= 0) return;
    for (let si = 0; si < segments.length; si++) {
      const s = segments[si];
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      let t = 0;
      while (t <= len + 0.5) {
        const cx = s.x1 + ux * Math.min(t, len);
        const cy = s.y1 + uy * Math.min(t, len);
        gParent.append("line")
          .attr("class", "cross-bary-strike")
          .attr("x1", cx - px * tickLen * 0.5)
          .attr("y1", cy - py * tickLen * 0.5)
          .attr("x2", cx + px * tickLen * 0.5)
          .attr("y2", cy + py * tickLen * 0.5)
          .attr("stroke", stroke)
          .attr("stroke-width", sw)
          .attr("stroke-linecap", "round")
          .attr("pointer-events", "none");
        t += spacing;
      }
    }
  }

  /** True for paths that are not inside a special-chord stripe group (metro strikes). */
  function pathOutsideSpecialChordGroup() {
    return function () {
      let n = this.parentElement;
      while (n) {
        if (n.getAttribute && n.getAttribute("data-special-edge") === "true") {
          return false;
        }
        n = n.parentElement;
      }
      return true;
    };
  }

  /** Sort key so chord and bary stripes interleave in draw order (reduces z-fighting). */
  function edgePathSortZ(ep) {
    let x, y;
    if (ep.type === "L") {
      x = (ep.sx + ep.cx + ep.cx) / 3;
      y = (ep.sy + ep.sy + ep.cy) / 3;
    } else {
      x = (ep.x1 + ep.x2) / 2;
      y = (ep.y1 + ep.y2) / 2;
    }
    return y * 1e6 + x;
  }

  /**
   * Metro paint bucket ≈ screen row so stripes at a junction share one draw batch:
   * sort by (bucket, line id, special last) so chord lanes sit with regular lanes.
   */
  function metroPaintBucket(ep) {
    return Math.floor(edgePathSortZ(ep) / 1e6);
  }

  function metroStrikeTickLenForStripeWidth(stripeW) {
    const lenF = CONFIG.crossBaryStrikeLengthFactor || 0.3;
    const maxFrac = CONFIG.crossBaryStrikeMaxSpanFrac || 0.34;
    const maxPx = Number(CONFIG.crossBaryStrikeMaxPx) || 4.5;
    const raw = stripeW * lenF;
    return Math.max(1.2, Math.min(raw, stripeW * maxFrac, maxPx));
  }

  /** Station diameter in px (2× radius) — reference for metro stripe widths. */
  function referenceStationDiameterPx() {
    return 2 * nodeRadius(1);
  }

  /**
   * Per-stripe width as a fraction of station diameter when up to 5 inputs are
   * selected (S). For S >= 6, use metroStripeWidthPx instead (uniform split).
   */
  function metroStripeWidthFraction(S) {
    if (S <= 0) return 0;
    if (S === 1) return 0.50;
    if (S === 2) return 0.30;
    if (S === 3) return 0.25;
    if (S === 4) return 0.22;
    if (S === 5) return 0.20;
    return 1 / S;
  }

  /**
   * Per-stripe width in px: based on selected input count S (never uses k > S).
   * If k >= 6 stripes on this edge, total stack = 100% of station diameter.
   */
  function metroStripeWidthPx(S, k, dPx) {
    if (S <= 0 || k <= 0) return 0;
    if (k >= 6) return dPx / k;
    return metroStripeWidthFraction(S) * dPx;
  }

  function renderEdgesBundled() {
    const maxPop = Math.max(...data.edges.map(e => e.lines.length), 1);
    const queue = [];
    const allSel = isAllSelected();
    const noSel = selectedLines.size === 0;
    const uniformBundledCompare = bundledMapOneToOneCompareView();

    data.edges.forEach((e, eidx) => {
      if (e.internalToBundle) return;
      if (isBaryNodeHiddenByFilter(e.source) || isBaryNodeHiddenByFilter(e.target)) return;
      const ep = edgePath(e, eidx);
      if (!ep) return;

      const mediated = _edgeMediatedLineSet[eidx] || new Set();
      const lineVisible = lid =>
        (allSel || noSel || selectedLines.has(lid)) && !mediated.has(lid);
      const activeLids = e.lines.filter(lineVisible).sort((a, b) => a - b);
      const spec = (e.specialChordLines || []).filter(lineVisible);
      const unionLids = [...new Set([...activeLids, ...spec])].sort((a, b) => a - b);
      if (!unionLids.length) return;

      const pathStr = orthoEdgePathD(ep);
      const w = uniformBundledCompare
        ? computeEdgeWidth(1, maxPop)
        : computeEdgeWidth(unionLids.length, maxPop);
      queue.push({
        z: edgePathSortZ(ep),
        eidx,
        pathStr,
        w
      });
    });

    queue.sort((a, b) => a.z - b.z);
    for (let qi = 0; qi < queue.length; qi++) {
      const it = queue[qi];
      _gEdges.append("path")
        .attr("d", it.pathStr)
        .attr("fill", "none")
        .attr("stroke", CONFIG.edgeColor)
        .attr("stroke-width", it.w)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("data-edge-idx", it.eidx)
        .attr("data-base-width", it.w)
        .attr("data-special-edge", "false");
    }
  }

  function renderEdgesMetro(selectionSet, selCountForWidth) {
    const selCount = Math.max(1, selCountForWidth);
    const dPx = referenceStationDiameterPx();
    const nLanes = Math.max(1, selectionSet.size);
    const Sdim = Math.max(selCount, nLanes);
    /** One lane width for every selected line everywhere (regular + strike stripes). */
    const stripeWGlobal = metroStripeWidthPx(Sdim, Sdim, dPx);
    const spF = CONFIG.crossBaryStrikeSpacingFactor || 1.2;
    const strikeSw = CONFIG.crossBaryStrikeWidth || 1.1;
    const strikeCol = CONFIG.crossBaryStrikeStroke || "rgba(0,0,0,0.42)";

    const stripeQueue = [];

    data.edges.forEach((e, eidx) => {
      if (e.internalToBundle) return;
      if (isBaryNodeHiddenByFilter(e.source) || isBaryNodeHiddenByFilter(e.target)) return;
      const ep = edgePath(e, eidx);
      if (!ep) return;

      const mediated = _edgeMediatedLineSet[eidx];
      const activeLids = e.lines
        .filter(lid => selectionSet.has(lid) && !mediated.has(lid))
        .sort((a, b) => a - b);

      const strikeLids = (e.specialChordLines || [])
        .filter(lid => selectionSet.has(lid) && !mediated.has(lid))
        .sort((a, b) => a - b);

      const routePopSel = activeLids.length;

      const minAllShared = CONFIG.metroAllSharedMinSelectedInputs;
      const isAllShared =
        minAllShared > 0 &&
        selCount >= minAllShared &&
        routePopSel === selCount;

      if (isAllShared) {
        const totalW = CONFIG.metroAllSharedWidthFraction * dPx;
        const pathStr = orthoEdgePathD(ep);
        _gEdges.append("path")
          .attr("d", pathStr)
          .attr("fill", "none")
          .attr("stroke", CONFIG.metroAllSharedColor)
          .attr("stroke-width", totalW)
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round")
          .attr("data-edge-idx", eidx)
          .attr("data-metro-all", "true")
          .attr("data-base-width", totalW);
        return;
      }

      if (routePopSel === 0 && strikeLids.length === 0) return;

      const unionLids = [...new Set([...activeLids, ...strikeLids])]
        .sort((a, b) => a - b);
      const strikeSet = new Set(strikeLids.map(Number));
      const nTotal = unionLids.length;
      if (nTotal === 0) return;

      unionLids.forEach((lid, k) => {
        const offset = (k - (nTotal - 1) / 2) * stripeWGlobal;
        const color = metroLineColor(lid);
        const pathStr = metroStripePathFromEp(ep, offset);
        const useStrikes = strikeSet.has(+lid);
        stripeQueue.push({
          bucket: metroPaintBucket(ep),
          specialEdge: useStrikes,
          eidx,
          lid,
          stripePath: pathStr,
          stripeW: stripeWGlobal,
          color,
          ep,
          offset,
          ce0: useStrikes
            ? { source: e.source, target: e.target, inputIdx: lid }
            : undefined,
          segs: useStrikes ? metroStripeSegmentsFromEp(ep, offset) : undefined
        });
      });
    });

    stripeQueue.sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.offset !== b.offset) return a.offset - b.offset;
      if (a.lid !== b.lid) return a.lid - b.lid;
      return (a.specialEdge ? 1 : 0) - (b.specialEdge ? 1 : 0);
    });
    for (let i = 0; i < stripeQueue.length; i++) {
      const it = stripeQueue[i];
      if (!it.specialEdge) {
        _gEdges.append("path")
          .attr("d", it.stripePath)
          .attr("fill", "none")
          .attr("stroke", it.color)
          .attr("stroke-width", it.stripeW)
          .attr("stroke-linecap", "butt")
          .attr("stroke-linejoin", "round")
          .attr("data-edge-idx", it.eidx)
          .attr("data-line-id", it.lid)
          .attr("data-base-width", it.stripeW)
          .attr("data-special-edge", "false");
      } else {
        const tickLen = metroStrikeTickLenForStripeWidth(it.stripeW);
        const spacing = Math.max(it.stripeW * spF, tickLen * 1.85);
        const gChord = _gEdges.append("g")
          .attr("class", "metro-special-chord")
          .attr("data-special-edge", "true")
          .attr("data-line-id", it.lid)
          .attr("data-bary-u", it.ce0.source)
          .attr("data-bary-v", it.ce0.target)
          .attr("data-base-width", it.stripeW);
        gChord.append("path")
          .attr("class", "metro-chord-stroke")
          .attr("d", it.stripePath)
          .attr("fill", "none")
          .attr("pointer-events", "stroke")
          .attr("stroke", it.color)
          .attr("stroke-width", it.stripeW)
          .attr("stroke-linecap", "butt")
          .attr("stroke-linejoin", "round");
        appendStrikeTicksOnSegments(gChord, it.segs, tickLen, spacing, strikeCol, strikeSw);
      }
    }
  }

  // ── Selection logic ─────────────────────────────────────────────

  function isAllSelected() {
    return data && selectedLines.size === data.lines.length;
  }

  function selectAll() {
    if (!data) return;
    selectedLines = new Set(data.lines.map(l => l.id));
    syncLegendUI();
    applySelection();
  }

  function clearSelection() {
    selectedLines.clear();
    syncLegendUI();
    applySelection();
  }

  function toggleLineSelection(lineId) {
    if (multiSelect) {
      if (selectedLines.has(lineId)) {
        selectedLines.delete(lineId);
      } else {
        selectedLines.add(lineId);
      }
    } else {
      if (selectedLines.size === 1 && selectedLines.has(lineId)) {
        selectAll();
        return;
      }
      selectedLines.clear();
      selectedLines.add(lineId);
    }
    syncLegendUI();
    applySelection();
  }

  function syncLegendUI() {
    const items = document.querySelectorAll(".legend-item");
    const allSel = isAllSelected();
    items.forEach(item => {
      const lid = +item.dataset.lineId;
      item.classList.toggle("selected", selectedLines.has(lid));
      item.classList.toggle("deselected",
        !allSel && !selectedLines.has(lid));
    });
    const btnAll = document.getElementById("btn-select-all");
    const btnClear = document.getElementById("btn-clear");
    if (btnAll) btnAll.disabled = isAllSelected();
    if (btnClear) btnClear.disabled = selectedLines.size === 0;
  }

  function applySelection() {
    if (!_gEdges || !data) return;

    applyBarycenterNodeDisplayColors(data);

    const allSel = isAllSelected();
    const noSel = selectedLines.size === 0;

    const activeNodes = new Set();
    if (!allSel && !noSel) {
      data.lines.forEach(l => {
        if (selectedLines.has(l.id)) {
          l.matchedNodes.forEach(nid => activeNodes.add(nid));
        }
      });
    }

    // ── Edge updates (mode-aware) ─────────────────────────────
    // Full redraw: metro stripe packing + strikes; bundled widths only (specials
    // widen gray, no strikes) — all depend on the current legend set.
    renderEdges();

    // Update stations
    _gStations.selectAll(".station").each(function () {
      const el = d3.select(this);
      if (allSel || noSel) {
        el.attr("opacity", 1);
      } else {
        const nodeIds = el.attr("data-node-ids").split(",").map(Number);
        const active = nodeIds.some(nid => activeNodes.has(nid));
        el.attr("opacity", active ? 1 : 0.25);
      }
    });

    // Unpaired nodes: only visible when exactly 1 input is selected
    if (_gUnpaired) {
      const showUnpaired = selectedLines.size === 1;
      _gUnpaired.selectAll(".unpaired-node").each(function () {
        const el = d3.select(this);
        const inputIdx = +el.attr("data-input-idx");
        const vis = showUnpaired && selectedLines.has(inputIdx);
        el.attr("opacity", vis ? 1 : 0);
      });
      _gUnpaired.selectAll(".stub-edge").each(function () {
        const el = d3.select(this);
        const inputIdx = +el.attr("data-input-idx");
        const vis = showUnpaired && selectedLines.has(inputIdx);
        el.attr("opacity", vis ? 0.7 : 0);
      });
    }

    // If hovering a legend line while selection changes, re-apply hover styling
    // after the full edge redraw (metro stripes + strikes, or bundled gray only).
    if (highlightedLine !== null) {
      highlightLine(highlightedLine);
    }

    updateInputTreePanel();
    syncInputTreeHint();
    updateCoordUncertaintyEllipses();
    syncMapStationDetailHighlight();
  }

  // ── Hover highlight ─────────────────────────────────────────────

  function resetCoordScatterPointStyles() {
    const svg = document.querySelector("#node-panel-body .coord-scatter-svg");
    if (!svg) return;
    svg.querySelectorAll("circle[data-base-sw]").forEach(c => {
      const sw = c.getAttribute("data-base-sw");
      if (sw != null) c.setAttribute("stroke", "rgba(255,255,255,0.92)");
      if (sw != null) c.setAttribute("stroke-width", sw);
    });
  }

  /** Legend hover: black rim on scatter points for this line if it is in the active legend set. */
  function syncCoordScatterLegendHover(lineId) {
    resetCoordScatterPointStyles();
    if (lineId == null || lineId === undefined || !data) return;
    const allSel = isAllSelected();
    const noSel = selectedLines.size === 0;
    const active = allSel || noSel || selectedLines.has(lineId);
    if (!active) return;
    const svg = document.querySelector("#node-panel-body .coord-scatter-svg");
    if (!svg) return;
    svg.querySelectorAll(`circle[data-input-idx="${lineId}"]`).forEach(c => {
      const baseSw = +c.getAttribute("data-base-sw") || 1;
      const rr = +c.getAttribute("data-r") || 1;
      c.setAttribute("stroke", "#000000");
      c.setAttribute("stroke-width", String(Math.max(baseSw * 4.5, rr * 0.5)));
    });
  }

  function highlightLine(lineId) {
    highlightedLine = lineId;
    const lineObj = data.lines.find(l => +l.id === +lineId);
    if (!_gEdges || !lineObj) {
      resetCoordScatterPointStyles();
      return;
    }

    const matchedSet = new Set(lineObj.matchedNodes);

    // ── Edge highlight (mode-aware) ───────────────────────────
    _gEdges.selectAll("g[data-special-edge=\"true\"]").each(function () {
      if (edgeMode !== "metro") return;
      const g = d3.select(this);
      const lid = +g.attr("data-line-id");
      const baseW = +g.attr("data-base-width");
      const strikeBoost = (CONFIG.crossBaryStrikeWidth || 1.25) + 0.55;
      if (lid === lineId) {
        g.style("display", null).attr("opacity", 1);
        g.select(".metro-chord-stroke")
          .attr("stroke-width", baseW + 1);
        g.selectAll(".cross-bary-strike")
          .attr("stroke-width", strikeBoost);
      } else {
        g.style("display", "none");
      }
    });

    _gEdges.selectAll("path").filter(pathOutsideSpecialChordGroup()).each(function () {
      const el = d3.select(this);
      const eidx = +el.attr("data-edge-idx");
      if (eidx < 0) return;

      const baseW = +el.attr("data-base-width");
      const onRoute = _edgeLineSet[eidx] && _edgeLineSet[eidx].has(lineId);
      const onStrike = _edgeSpecialChordLineSet[eidx] &&
                        _edgeSpecialChordLineSet[eidx].has(lineId);
      const isMediated = _edgeMediatedLineSet[eidx] &&
                         _edgeMediatedLineSet[eidx].has(lineId);
      const edgeActive = (onRoute || onStrike) && !isMediated;

      if (edgeMode === "metro") {
        const isAll = el.attr("data-metro-all") === "true";
        if (isAll) {
          el.style("display", edgeActive ? null : "none");
          el.attr("opacity", 1);
        } else {
          const lid = +el.attr("data-line-id");
          if (lid === lineId && edgeActive) {
            el.style("display", null)
              .attr("opacity", 1)
              .attr("stroke-width", baseW + 1);
          } else {
            el.style("display", "none")
              .attr("stroke-width", baseW);
          }
        }
      } else {
        if (edgeActive) {
          el.attr("stroke", metroLineColor(lineObj))
            .attr("stroke-width", baseW + CONFIG.edgeHighlightBoost)
            .attr("opacity", 1);
        } else {
          el.attr("stroke", CONFIG.edgeColor)
            .attr("stroke-width", baseW)
            .attr("opacity", CONFIG.edgeDimOpacity);
        }
      }
    });

    _gStations.selectAll(".station").each(function () {
      const el = d3.select(this);
      const nodeIds = el.attr("data-node-ids").split(",").map(Number);
      const isMatched = nodeIds.some(nid => matchedSet.has(nid));
      el.attr("opacity", isMatched ? 1 : 0.25);
    });

    // Show hovered line's unpaired nodes (only when exactly one input
    // is selected to avoid clutter in multi-input views).
    if (_gUnpaired) {
      const showUnpaired = selectedLines.size === 1;
      _gUnpaired.selectAll(".unpaired-node").each(function () {
        const el = d3.select(this);
        const idx = +el.attr("data-input-idx");
        el.attr("opacity", (showUnpaired && idx === lineId) ? 1 : 0);
      });
      _gUnpaired.selectAll(".stub-edge").each(function () {
        const el = d3.select(this);
        const idx = +el.attr("data-input-idx");
        el.attr("opacity", (showUnpaired && idx === lineId) ? 0.7 : 0);
      });
    }

    syncCoordScatterLegendHover(lineId);
  }

  function clearHighlight() {
    highlightedLine = null;
    resetCoordScatterPointStyles();
    applySelection();
  }

  function getSelectionSet() {
    const noSel = selectedLines.size === 0;
    const allSel = isAllSelected();
    if (allSel || noSel) return new Set(data.lines.map(l => l.id));
    return new Set(selectedLines);
  }

  /** Recompute coord PCA ellipses + station fills from legend selection (no full render). */
  function updateCoordUncertaintyEllipses() {
    if (!data || !_gStations || !_bundleById) return;
    const sel = getSelectionSet();
    const coordUnc = computeAllCoordUncertainties(data, sel);
    const uncPack = computeActiveUncertaintyScale(data, sel);
    const catMode = baryCenterCategoricalNodeEncoding();
    const uncVar = functionUncertaintyActive(catMode);

    _gStations.selectAll(".coord-uncertainty-ellipse").remove();

    _gStations.selectAll(".station").each(function () {
      const g = d3.select(this);
      const nodeIdsStr = g.attr("data-node-ids");
      if (!nodeIdsStr) return;
      const nodeIds = nodeIdsStr.split(",").map(Number);
      const isBundle = g.classed("bundle");
      const rPx = isBundle ? nodeRadius(nodeIds.length) : nodeRadius(1);
      let spec = null;
      if (isBundle) {
        const bid = +g.attr("data-bundle-id");
        const bundle = _bundleById.get(bid);
        if (bundle) {
          spec = bundleCoordUncertaintySpec(
            data, bundle, coordUnc.maxCoordDiff, sel);
        }
        const bundleDrawsEll = baryStationShowsCoordUncertaintyEllipse(spec, rPx);
        g.selectAll(".station-wedge").each(function () {
          const p = d3.select(this);
          const mid = +p.attr("data-member-id");
          const m = _nodeById.get(mid);
          if (!m) return;
          const wedgeFill = baryCoordUncDiskFill(
            bundleDrawsEll, catMode, m.color, uncVar);
          p.attr("fill", wedgeFill);
        });
        const bundleFillsAfter = [];
        g.selectAll(".station-wedge").each(function () {
          bundleFillsAfter.push(d3.select(this).attr("fill"));
        });
        const bundleLabelFills = bundleFillsAfter.slice();
        if (!catMode && bundleDrawsEll && uncVar && bundle) {
          const ms = meanMemberHeightStd(bundle, uncPack);
          const ellFill = stdToSequentialVariationFill(ms, uncPack.maxStd);
          insertCoordUncertaintyEllipse(g, rPx, spec, ellFill);
          bundleLabelFills.push(ellFill);
        }
        g.select("text.station-label")
          .attr("fill", contrastLabelFillForFills(bundleLabelFills));
      } else if (nodeIds.length) {
        const nid = nodeIds[0];
        spec = coordUnc.byId.get(nid);
        const n = _nodeById.get(nid);
        const drawsEll = baryStationShowsCoordUncertaintyEllipse(spec, rPx);
        const disk = g.select(".station-std-disk");
        let diskFill = "#ffffff";
        if (n) {
          diskFill = baryCoordUncDiskFill(drawsEll, catMode, n.color, uncVar);
          if (!disk.empty()) disk.attr("fill", diskFill);
        }
        const labelFills = [diskFill];
        if (!catMode && drawsEll && uncVar && n) {
          const ellFill = stdToSequentialVariationFill(
            uncPack.byId.get(nid) || 0,
            uncPack.maxStd);
          insertCoordUncertaintyEllipse(g, rPx, spec, ellFill);
          labelFills.push(ellFill);
        }
        g.select("text.station-label")
          .attr("fill", contrastLabelFillForFills(labelFills));
      }
    });
    updateBaryStdColorbarPanel(uncPack);
  }

  function activeEdgeInputs(eidx) {
    const edge = data.edges[eidx];
    if (!edge) return [];
    const sel = getSelectionSet();
    const mediated = _edgeMediatedLineSet[eidx] || new Set();
    const regular = edge.lines.filter(lid => sel.has(lid) && !mediated.has(lid));
    const strike = (edge.specialChordLines || []).filter(
      lid => sel.has(lid) && !mediated.has(lid));
    return [...new Set([...regular, ...strike])].sort((a, b) => a - b);
  }

  function bindEdgeHoverTooltip() {
    if (!_gEdges) return;
    const tooltip = d3.select("#tooltip");
    const moveTip = (event) => {
      tooltip
        .style("left", (event.pageX + 14) + "px")
        .style("top", (event.pageY - 10) + "px");
    };
    const hideTip = () => {
      tooltip.classed("input-tree-tip", false).classed("visible", false);
    };

    _gEdges.selectAll("g[data-special-edge=\"true\"]")
      .on("mouseenter", function () {
        const el = d3.select(this);
        const u = el.attr("data-bary-u");
        const v = el.attr("data-bary-v");
        const lid = +el.attr("data-line-id");
        const lc = metroLineColor(lid);
        tooltip.classed("input-tree-tip", false).html(
          `<b>Critical input-tree link (bary path segment)</b><br>` +
          `Steiner edge ${u}\u2013${v}<br>` +
          `<span style="color:${lc}">\u25CF</span> Input ${lid}: ` +
          `an input-tree edge bridges disconnected parts of this line\u2019s ` +
          `metro subgraph; strikes mark this Steiner segment on the path.<br>` +
          `<span style="color:#868e96;font-size:11px;">` +
          `Computed in prepare_data (union-find + shortest path on the bary tree).</span>`
        ).classed("visible", true);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);

    _gEdges.selectAll("path").filter(pathOutsideSpecialChordGroup())
      .on("mouseenter", function () {
        const el = d3.select(this);
        const eidx = +el.attr("data-edge-idx");
        const e = data.edges[eidx];
        if (!e) return;
        const lids = activeEdgeInputs(eidx);
        const list = lids.length
          ? lids.map(i => `Input ${i}`).join(", ")
          : "None in current selection";
        tooltip.classed("input-tree-tip", false).html(
          `<b>Edge ${e.source}-${e.target}</b><br>` +
          `Inputs: ${lids.length}<br>` +
          `${list}`
        ).classed("visible", true);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip);
  }

  function statsSummary(values) {
    if (!values.length) return "n=0";
    const n = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const var0 = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
    const std = Math.sqrt(var0);
    return `n=${n}, min=${min.toFixed(4)}, mean=${mean.toFixed(4)}, ` +
      `max=${max.toFixed(4)}, std=${std.toFixed(4)}`;
  }

  function quantileSorted(sorted, p) {
    const n = sorted.length;
    if (n === 0) return NaN;
    if (n === 1) return sorted[0];
    const pos = (n - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sorted[lo];
    const w = pos - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }

  /**
   * Tukey-style quartiles with whiskers at the most extreme points inside 1.5×IQR;
   * points outside are listed as outliers (shown when there is room).
   */
  function boxPlotSummary(sorted) {
    const n = sorted.length;
    const minV = sorted[0];
    const maxV = sorted[n - 1];
    const q1 = quantileSorted(sorted, 0.25);
    const q2 = quantileSorted(sorted, 0.5);
    const q3 = quantileSorted(sorted, 0.75);
    const iqr = q3 - q1;
    const loF = q1 - 1.5 * iqr;
    const hiF = q3 + 1.5 * iqr;
    let whiskLo = minV;
    let whiskHi = maxV;
    for (let i = 0; i < n; i++) {
      if (sorted[i] >= loF) {
        whiskLo = sorted[i];
        break;
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      if (sorted[i] <= hiF) {
        whiskHi = sorted[i];
        break;
      }
    }
    const outliers = [];
    for (let i = 0; i < n; i++) {
      const v = sorted[i];
      if (v < whiskLo || v > whiskHi) outliers.push(v);
    }
    return { n, minV, maxV, q1, q2, q3, whiskLo, whiskHi, outliers };
  }

  /**
   * Inline SVG horizontal box plot for matched function values (heights).
   */
  function functionValueBoxPlotSvgHtml(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) {
      return (
        "<div style=\"color:#868e96;font-size:12px;\">" +
        "No matched heights for the current legend selection.</div>"
      );
    }
    const bp = boxPlotSummary(sorted);
    const W = 300;
    const H = 56;
    const padL = 6;
    const padR = 6;
    const padT = 8;
    const padB = 18;
    const plotW = W - padL - padR;
    const midY = padT + (H - padT - padB) * 0.5;
    const boxHalfH = 11;
    const lo = Math.min(bp.whiskLo, bp.q1);
    const hi = Math.max(bp.whiskHi, bp.q3);
    const span = hi - lo;
    const pad = span > 0 ? span * 0.04 : Math.max(Math.abs(lo) * 0.02, 1e-6);
    const vmin = lo - pad;
    const vmax = hi + pad;
    const srange = vmax - vmin;
    const xOf = (v) => padL + ((v - vmin) / srange) * plotW;
    const xQ1 = xOf(bp.q1);
    const xQ2 = xOf(bp.q2);
    const xQ3 = xOf(bp.q3);
    const xWL = xOf(bp.whiskLo);
    const xWR = xOf(bp.whiskHi);
    const cap = 5;
    const fmt = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
    const parts = [
      `<svg viewBox="0 0 ${W} ${H}" class="fn-value-boxplot-svg" ` +
        `preserveAspectRatio="xMidYMid meet" aria-label="Function value box plot">`,
      `<line x1="${xWL}" x2="${xWR}" y1="${midY}" y2="${midY}" ` +
        `stroke="#495057" stroke-width="1.5" stroke-linecap="round"/>`,
      `<line x1="${xWL}" x2="${xWL}" y1="${midY - cap}" y2="${midY + cap}" ` +
        `stroke="#495057" stroke-width="1.5"/>`,
      `<line x1="${xWR}" x2="${xWR}" y1="${midY - cap}" y2="${midY + cap}" ` +
        `stroke="#495057" stroke-width="1.5"/>`,
    ];
    const boxLeft = Math.min(xQ1, xQ3);
    const boxW = Math.max(Math.abs(xQ3 - xQ1), 2);
    parts.push(
      `<rect x="${boxLeft}" y="${midY - boxHalfH}" width="${boxW}" ` +
        `height="${2 * boxHalfH}" fill="#e9ecef" stroke="#495057" stroke-width="1.5" rx="2"/>`
    );
    parts.push(
      `<line x1="${xQ2}" x2="${xQ2}" y1="${midY - boxHalfH}" y2="${midY + boxHalfH}" ` +
        `stroke="#212529" stroke-width="2.5"/>`
    );
    if (bp.outliers.length) {
      const r = 2.2;
      for (let oi = 0; oi < bp.outliers.length; oi++) {
        const ox = xOf(bp.outliers[oi]);
        parts.push(
          `<circle cx="${ox}" cy="${midY}" r="${r}" fill="#c92a2a" stroke="#fff" stroke-width="0.6"/>`
        );
      }
    }
    parts.push(
      `<text x="${padL}" y="${H - 4}" font-size="9" fill="#868e96">` +
        `${escapeSvgText("min " + fmt(bp.minV))}</text>`,
      `<text x="${W / 2}" y="${H - 4}" text-anchor="middle" font-size="9" fill="#868e96">` +
        `${escapeSvgText("med " + fmt(bp.q2))}</text>`,
      `<text x="${W - padR}" y="${H - 4}" text-anchor="end" font-size="9" fill="#868e96">` +
        `${escapeSvgText("max " + fmt(bp.maxV))}</text>`,
      `</svg>`
    );
    return (
      `<div class="fn-value-boxplot-wrap">` +
      parts.join("") +
      `<div style="margin-top:4px;font-size:11px;color:#6c757d;">` +
      `Q1=${fmt(bp.q1)}, Q3=${fmt(bp.q3)}, IQR=${fmt(bp.q3 - bp.q1)}` +
      (bp.outliers.length
        ? ` · <span style="color:#c92a2a;">${bp.outliers.length} outlier(s)</span>`
        : "") +
      `</div></div>`
    );
  }

  /** Coordinate lines: bracket range plus mean and std (matches map entropy binning). */
  function coordAxisStatsLine(values) {
    if (!values.length) return "n=0";
    const n = values.length;
    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / n;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const var0 = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
    const std = Math.sqrt(var0);
    return `n=${n}, [${min.toFixed(4)}, ${max.toFixed(4)}], mean=${mean.toFixed(
      4)}, std=${std.toFixed(4)}`;
  }

  function coordStatsHtml(xs, ys, zs) {
    const nx = xs.length;
    const ny = ys.length;
    const nz = zs.length;
    if (nx === 0 && ny === 0 && nz === 0) {
      return (
        "<div style=\"color:#868e96;font-size:12px;\">" +
        "Per-input x, y, z are not available: the bundled JSON has " +
        "<code>coord</code> fields, but values are <code>null</code> because " +
        "the exported <code>input_trees/tree_*.json</code> files do not " +
        "include coordinate maps (only heights/types). " +
        "Regenerate exports with positions, or use input trees whose nodes " +
        "include x/y/z (see <code>prepare_data._coord_value</code>).</div>"
      );
    }
    return (
      `x: ${coordAxisStatsLine(xs)}<br>y: ${coordAxisStatsLine(ys)}<br>z: ${coordAxisStatsLine(zs)}`
    );
  }

  function formatCouplingMassEdge(x) {
    if (!Number.isFinite(x)) return "?";
    const a = Math.abs(x);
    if (a === 0) return "0";
    if (a >= 1e3 || (a < 1e-3 && a > 0)) return x.toExponential(2);
    if (a < 0.1) return x.toFixed(4);
    return x.toFixed(3);
  }

  /** Half-open ranges; last bin closed at vmax (values at max fall in last bin). */
  function formatCouplingBinRange(lo, hi, isLastBin) {
    const a = formatCouplingMassEdge(lo);
    const b = formatCouplingMassEdge(hi);
    return isLastBin ? `[${a}, ${b}]` : `[${a}, ${b})`;
  }

  function escapeSvgText(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  /**
   * SVG histogram of thresholded coupling masses (same bins as probabilistic uncertainty H).
   */
  function couplingEntropyHistogramHtml(nd, selectedInputSet) {
    if (!nd || !data) {
      return "<div class=\"coupling-hist-empty\">No data.</div>";
    }
    const pu = data.meta && data.meta.probUncertainty;
    const nBins = (pu && Number.isFinite(pu.entropyBins) && pu.entropyBins > 0)
      ? Math.floor(pu.entropyBins)
      : 5;
    const thr = (pu && Number.isFinite(pu.massThresholdFrac))
      ? pu.massThresholdFrac
      : 0.1;
    const vals = collectCouplingMassValuesForNode(nd, selectedInputSet);
    const det = couplingMassBinningDetails(vals, nBins);
    if (!det.n) {
      return (
        "<div class=\"coupling-hist-empty\">No thresholded coupling masses for " +
        "the current legend selection (or <code>couplingRowMasses</code> missing " +
        "— re-run <code>prepare_data.py</code>).</div>"
      );
    }
    const W = 280;
    const padL = 32;
    const padR = 10;
    const padT = 28;
    const padB = 58;
    const plotW = W - padL - padR;
    const plotH = 88;
    const H = det.H;
    const Hstr = Number.isFinite(H) ? H.toFixed(4) : "—";
    const maxC = Math.max(...det.counts, 1);
    const bw = plotW / det.nBins;
    const gap = Math.min(4, bw * 0.12);
    const barW = Math.max(1, bw - gap);
    const span = det.vmax > 0 ? det.vmax : 0;
    const xAxisY = padT + plotH + 20;
    const parts = [];
    const tickParts = [];
    if (!(span > 0)) {
      const h0 = (det.counts[0] / maxC) * plotH;
      const y0 = padT + plotH - h0;
      parts.push(
        `<rect class="coupling-hist-bar" x="${padL}" y="${y0.toFixed(2)}" ` +
        `width="${plotW}" height="${h0.toFixed(2)}">` +
        `<title>count=${det.counts[0]} · [0, 0]</title></rect>`);
      tickParts.push(
        `<text class="coupling-hist-tick" x="${(padL + plotW / 2).toFixed(2)}" ` +
        `y="${xAxisY.toFixed(2)}" text-anchor="middle">[0, 0]</text>`);
    } else {
      for (let b = 0; b < det.nBins; b++) {
        const lo = (span * b) / det.nBins;
        const hi = (span * (b + 1)) / det.nBins;
        const h = (det.counts[b] / maxC) * plotH;
        const x = padL + b * bw + gap / 2;
        const y = padT + plotH - h;
        const isLast = b === det.nBins - 1;
        const rangeLabel = formatCouplingBinRange(lo, hi, isLast);
        const tip = `count=${det.counts[b]} · ${rangeLabel}`;
        const tipEsc = escapeSvgText(tip);
        parts.push(
          `<rect class="coupling-hist-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
          `width="${barW.toFixed(2)}" height="${h.toFixed(2)}">` +
          `<title>${tipEsc}</title></rect>`);
        const tx = padL + b * bw + bw / 2;
        const rot = det.nBins > 4 ? -38 : -28;
        tickParts.push(
          `<text class="coupling-hist-tick" x="${tx.toFixed(2)}" y="${xAxisY.toFixed(2)}" ` +
          `text-anchor="middle" dominant-baseline="middle" ` +
          `transform="rotate(${rot} ${tx.toFixed(2)} ${xAxisY.toFixed(2)})">` +
          `${escapeSvgText(rangeLabel)}</text>`);
      }
    }
    const rangeCaption =
      span > 0
        ? `[0, ${formatCouplingMassEdge(span)}]`
        : "[0, 0]";
    return (
      `<div class="coupling-hist-wrap">` +
      `<div class="coupling-hist-H">H = ${Hstr} nats ` +
      `<span class="coupling-hist-H-sub">(${det.n} values, ${det.nBins} bins)</span></div>` +
      `<svg class="coupling-hist-svg" viewBox="0 0 ${W} ${padT + plotH + padB}" ` +
      `preserveAspectRatio="xMidYMid meet" aria-label="Coupling mass histogram">` +
      `<rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" ` +
      `fill="#f8f9fa" stroke="#ced4da" stroke-width="1" />` +
      parts.join("") +
      tickParts.join("") +
      `</svg>` +
      `<div class="coupling-hist-caption">Masses \u2265 ${thr}\u00d7 row sum per selected input, ` +
      `pooled then binned uniformly on ${rangeCaption} (same as probabilistic uncertainty on the map). ` +
      `Axis: bin value ranges. Hover a bar for count.</div>` +
      `</div>`
    );
  }

  /** Original scalar-field rectangle for 2D scatter (meta.spatialDomain or heuristic). */
  function spatialDomainForPanel(meta, xyPairs) {
    const m = meta && meta.spatialDomain;
    if (m && Array.isArray(m.x) && m.x.length === 2 &&
        Array.isArray(m.y) && m.y.length === 2) {
      return {
        xmin: m.x[0],
        xmax: m.x[1],
        ymin: m.y[0],
        ymax: m.y[1]
      };
    }
    if (meta && meta.dataset && /HeatedFlow/i.test(String(meta.dataset))) {
      return { xmin: 0, xmax: 127, ymin: 0, ymax: 255 };
    }
    if (xyPairs.length) {
      const xs = xyPairs.map(p => p[0]);
      const ys = xyPairs.map(p => p[1]);
      const pad = 0.02;
      const mx = Math.min(...xs);
      const Mx = Math.max(...xs);
      const my = Math.min(...ys);
      const My = Math.max(...ys);
      const dx = Mx - mx || 1;
      const dy = My - my || 1;
      return {
        xmin: mx - dx * pad,
        xmax: Mx + dx * pad,
        ymin: my - dy * pad,
        ymax: My + dy * pad
      };
    }
    return { xmin: 0, xmax: 1, ymin: 0, ymax: 1 };
  }

  function toColorInputValue(c) {
    const col = d3.color(c);
    return col ? col.formatHex() : "#808080";
  }

  /**
   * Scatter in original (x,y) domain. `points`: {x, y, inputIdx?} or legacy [x, y].
   * Fills are red; `data-input-idx` supports legend-hover outline in the node panel.
   */
  function coordScatterSvgHtml(meta, points) {
    if (!points.length) {
      return "<div class=\"coord-scatter-empty\">No (x, y) samples to plot.</div>";
    }
    const norm = points.map(p => {
      if (Array.isArray(p)) {
        return { x: p[0], y: p[1], inputIdx: p[2] };
      }
      return p;
    });
    const xyPairs = norm.map(p => [p.x, p.y]);
    const domain = spatialDomainForPanel(meta, xyPairs);
    const ddx = domain.xmax - domain.xmin || 1;
    const ddy = domain.ymax - domain.ymin || 1;
    const r = Math.max(ddx, ddy) * 0.006;
    const borderW = Math.max(Math.max(ddx, ddy) * 0.0022, r * 0.22);
    // Extra view padding (data units) so the plot frame stroke does not sit on top of edge points.
    const pad = Math.max(borderW * 1.75, Math.max(ddx, ddy) * 0.035, r * 2.5);
    const xmin = domain.xmin - pad;
    const xmax = domain.xmax + pad;
    const ymin = domain.ymin - pad;
    const ymax = domain.ymax + pad;
    const dx = xmax - xmin || 1;
    const dy = ymax - ymin || 1;
    const vb = `${xmin} ${ymin} ${dx} ${dy}`;
    const sw = Math.max(r * 0.22, Math.max(ddx, ddy) * 0.0012);
    const fillRed = "#e03131";
    const fillGray = "#868e96";
    const circles = norm.map((p) => {
      const fill = Number.isFinite(p.inputIdx) ? fillRed : fillGray;
      const idxAttr = Number.isFinite(p.inputIdx)
        ? ` data-input-idx="${p.inputIdx}"`
        : "";
      return (
        `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${fill}"` +
        `${idxAttr} data-base-sw="${sw}" data-r="${r}" ` +
        `stroke="rgba(255,255,255,0.92)" stroke-width="${sw}" />`
      );
    }).join("");
    return (
      `<div class="coord-scatter-wrap">` +
      `<svg viewBox="${vb}" preserveAspectRatio="xMidYMid meet" ` +
      `class="coord-scatter-svg" aria-hidden="true">` +
      `<rect x="${xmin}" y="${ymin}" width="${dx}" height="${dy}" fill="#ffffff" ` +
      `stroke="#495057" stroke-width="${borderW}" />` +
      circles +
      `</svg></div>` +
      `<div class="coord-scatter-caption">Domain: x\u2208[${domain.xmin}, ${domain.xmax}], ` +
      `y\u2208[${domain.ymin}, ${domain.ymax}] · ${norm.length} points (red). ` +
      `Hover a line in the legend to outline its points (when that line is in the current selection). ` +
      `View is padded so edge points sit inside the frame.</div>`
    );
  }

  function renderNodePanel() {
    const panel = document.getElementById("node-panel");
    const body = document.getElementById("node-panel-body");
    // Node id can be 0, so we must check null/undefined explicitly.
    if (_selectedDetailNodeId === null ||
        _selectedDetailNodeId === undefined ||
        !_nodeById.has(_selectedDetailNodeId) ||
        isBaryNodeHiddenByFilter(_selectedDetailNodeId)) {
      panel.classList.add("collapsed");
      syncMapStationDetailHighlight();
      return;
    }
    panel.classList.remove("collapsed");

    const nd = _nodeById.get(_selectedDetailNodeId);
    const sel = getSelectionSet();
    const idx = data.nodeMatchIndex ? data.nodeMatchIndex[String(nd.id)] : null;
    const byInput = idx ? (idx.byInput || {}) : {};
    const fallbackInputs = data.lines
      .map(l => l.id)
      .filter(i => sel.has(i) && data.lines[i].matchedNodes.includes(nd.id));
    const matchedInputs = Object.keys(byInput)
      .map(k => +k)
      .filter(i => sel.has(i))
      .sort((a, b) => a - b);
    const matchedInputsEff = matchedInputs.length ? matchedInputs : fallbackInputs;

    const recs = [];
    matchedInputsEff.forEach(i => {
      const arr = byInput[String(i)] || [];
      arr.forEach(r => recs.push(r));
    });

    const heights = recs.map(r => r.height).filter(v => Number.isFinite(v));
    const xs = recs.map(r => r.coord && r.coord.x).filter(v => Number.isFinite(v));
    const ys = recs.map(r => r.coord && r.coord.y).filter(v => Number.isFinite(v));
    const zs = recs.map(r => r.coord && r.coord.z).filter(v => Number.isFinite(v));
    const xyPoints = [];
    recs.forEach(r => {
      if (r.coord && Number.isFinite(r.coord.x) && Number.isFinite(r.coord.y)) {
        xyPoints.push({
          x: r.coord.x,
          y: r.coord.y,
          inputIdx: r.inputIdx
        });
      }
    });

    const neighbors = data.edges
      .filter(e => e.source === nd.id || e.target === nd.id)
      .map(e => (e.source === nd.id ? e.target : e.source))
      .sort((a, b) => a - b);

    let html = "";
    if (_bundleCandidateIds.length > 1) {
      html += `<div class="panel-section"><div class="panel-title">Bundle Members</div>` +
        `<div class="bundle-candidates">` +
        _bundleCandidateIds.map(nid =>
          `<button class="${nid === _selectedDetailNodeId ? "active" : ""}" data-member-id="${nid}">Node ${nid}</button>`
        ).join("") +
        `</div></div>`;
    }
    const softTypePanel = barySoftTypeDistributionHtml(nd, "panel");
    html += `<div class="panel-section"><div class="panel-title">Node ${nd.id}</div>` +
      `<div>Height=${nd.height.toFixed(4)}, Type=${nd.type}` +
      ` <span style="color:#868e96;font-size:11px;">(argmax)</span></div>` +
      (softTypePanel ? `<div style="margin-top:4px;">${softTypePanel}</div>` : "") +
      `</div>`;
    const defLabel =
      nodeColorScheme === "categorical" ? "categorical palette" : "dataset JSON";
    html += `<div class="panel-section">` +
      `<div class="panel-title">Node color</div>` +
      `<div class="node-color-row">` +
      `<input type="color" id="node-detail-color" value="${toColorInputValue(nd.color)}" ` +
      `title="Fill for this station on the map and on matched input-tree nodes" />` +
      `<button type="button" class="node-color-apply" id="node-detail-color-apply">` +
      `Apply</button>` +
      `<button type="button" class="node-color-reset" id="node-detail-color-reset">` +
      `Clear override</button>` +
      `</div>` +
      `<p class="node-color-hint">Overrides use this color instead of the ${defLabel} default. ` +
      `Choose a color, then click Apply to confirm. Saved for this dataset in the browser.</p>` +
      `</div>`;
    const selAll = getSelectionSet();
    const allTiles = data.lines.map(l => {
      const lid = l.id;
      const selected = selAll.has(lid);
      const hasNode =
        Array.isArray(l.matchedNodes) && l.matchedNodes.includes(nd.id);
      const cls = [
        "input-tile",
        hasNode ? "input-tile--present" : "input-tile--absent",
        selected ? "input-tile--selected" : ""
      ].filter(Boolean).join(" ");
      let style = "";
      if (hasNode) {
        const lc = metroLineColor(l);
        const fg = isLightColor(lc) ? "#111" : "#fff";
        style =
          `background-color:${lc};color:${fg};border-color:${lc};`;
      }
      return `<div class="${cls}" style="${style}" title="Input ${lid}">${lid}</div>`;
    }).join("");

    html += `<div class="panel-section"><div class="panel-title">Input selection &amp; match</div>` +
      `<div class="input-grid">${allTiles}</div>` +
      `<div style="margin-top:6px;color:#6c757d;font-size:11px;">` +
      `Gray = this input has no node at this station; ` +
      `colored = matched; dark ring = selected in the legend.` +
      `</div>` +
      `</div>`;

    html += `<div class="panel-section"><div class="panel-title">Function value distribution</div>` +
      `<div style="font-size:12px;margin-bottom:6px;color:#495057;">${statsSummary(heights)}</div>` +
      `${functionValueBoxPlotSvgHtml(heights)}</div>`;
    html += `<div class="panel-section"><div class="panel-title">Coordinate distribution</div>` +
      coordScatterSvgHtml(data.meta || {}, xyPoints) +
      `<div style="margin-top:8px;">` +
      coordStatsHtml(xs, ys, zs) +
      `</div>` +
      `<div class="panel-subtitle coupling-hist-section-title">Coupling mass bins (entropy)</div>` +
      couplingEntropyHistogramHtml(nd, sel) +
      `</div>`;
    if (!data.nodeMatchIndex || !idx) {
      html += `<div class="panel-section"><i>Detailed matched-node records are unavailable in this JSON. ` +
        `Run prepare_data.py and hard-refresh the page.</i></div>`;
    }
    html += `<div class="panel-section"><div class="panel-title">Barycenter Adjacent Nodes</div>` +
      (neighbors.length ? neighbors.map(n => `<span class="chip">${n}</span>`).join("") : "None") +
      `</div>`;
    const swapOptions = data.nodes
      .map(n => +n.id)
      .filter(nid => nid !== nd.id)
      .sort((a, b) => a - b)
      .map(nid => `<option value="${nid}">Node ${nid}</option>`)
      .join("");
    html += `<div class="panel-section">` +
      `<div class="panel-title">Layout edit</div>` +
      `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">` +
      `<label for="node-layout-swap-target" style="font-size:12px;color:#495057;">Swap x with</label>` +
      `<select id="node-layout-swap-target" style="min-width:110px;">${swapOptions}</select>` +
      `<button type="button" id="node-layout-swap-apply">Swap x</button>` +
      `</div>` +
      `<div style="margin-top:6px;color:#6c757d;font-size:11px;">` +
      `Exchanges only the x-position of Node ${nd.id} and the selected node.` +
      `</div>` +
      `</div>`;

    body.innerHTML = html;
    body.querySelectorAll("button[data-member-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        _selectedDetailNodeId = +btn.getAttribute("data-member-id");
        renderNodePanel();
      });
    });
    const cp = body.querySelector("#node-detail-color");
    const ca = body.querySelector("#node-detail-color-apply");
    const cr = body.querySelector("#node-detail-color-reset");
    if (cp) {
      const syncApplyState = () => {
        if (!ca) return;
        const cur = toColorInputValue(nd.color);
        const nxt = toColorInputValue(cp.value);
        ca.disabled = cur === nxt;
      };
      syncApplyState();
      cp.addEventListener("input", () => {
        syncApplyState();
      });
      cp.addEventListener("change", () => {
        syncApplyState();
      });
    }
    if (cp && ca) {
      ca.addEventListener("click", () => {
        setNodeColorOverrideForCurrentStem(nd.id, cp.value);
        if (data) render(data);
        renderNodePanel();
      });
    }
    if (cr) {
      cr.addEventListener("click", () => {
        removeNodeColorOverrideForCurrentStem(nd.id);
        if (data) render(data);
        renderNodePanel();
      });
    }
    const swapSel = body.querySelector("#node-layout-swap-target");
    const swapBtn = body.querySelector("#node-layout-swap-apply");
    if (swapSel && swapBtn) {
      swapBtn.addEventListener("click", () => {
        const otherId = Number(swapSel.value);
        if (!Number.isFinite(otherId)) return;
        if (!swapSelectedNodeXWith(nd.id, otherId)) return;
        if (data) render(data);
      });
    }
    syncMapStationDetailHighlight();
  }

  // ── Helpers ──────────────────────────────────────────────────────

  function nodeRadius(memberCount) {
    return CONFIG.nodeRadiusBase +
      CONFIG.nodeRadiusPerMember * memberCount;
  }

  /** Linear luminance 0–255 (same weighting as {@link isLightColor}). */
  function linearLuminance255(col) {
    const c = d3.color(col);
    if (!c) return 128;
    return c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  }

  /**
   * Label text on bary stations: if **any** swatch under the glyph (disk, wedge, or
   * coord-uncertainty ellipse fill) is fairly dark, use white; else use average RGB
   * vs a light threshold (pie wedges + neutral disk).
   */
  function contrastLabelFillForFills(fillList) {
    if (!fillList || !fillList.length) return "#343a40";
    let r = 0;
    let g = 0;
    let b = 0;
    let c = 0;
    let minLum = 256;
    for (let i = 0; i < fillList.length; i++) {
      const col = d3.color(fillList[i]);
      if (col) {
        const lum = linearLuminance255(col);
        if (lum < minLum) minLum = lum;
        r += col.r;
        g += col.g;
        b += col.b;
        c++;
      }
    }
    if (!c) return "#343a40";
    if (minLum < 130) return "#fff";
    const avg = d3.rgb(r / c, g / c, b / c);
    return linearLuminance255(avg) > 160 ? "#343a40" : "#fff";
  }

  function isLightColor(c) {
    const col = d3.color(c);
    if (!col) {
      const hex = String(c || "").replace("#", "");
      if (hex.length !== 6) return true;
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return (r * 0.299 + g * 0.587 + b * 0.114) > 160;
    }
    return (col.r * 0.299 + col.g * 0.587 + col.b * 0.114) > 160;
  }

  // ── Legend ────────────────────────────────────────────────────────

  /** All / Clear live in the legend header so they stay visible when the list is collapsed. */
  function setupLegendHeaderActions() {
    const header = document.getElementById("legend-header");
    if (!header) return;
    const existing = document.getElementById("legend-header-actions");
    if (existing) existing.remove();

    const wrap = document.createElement("span");
    wrap.id = "legend-header-actions";
    wrap.className = "legend-header-actions";

    const btnAll = document.createElement("button");
    btnAll.type = "button";
    btnAll.id = "btn-select-all";
    btnAll.textContent = "All";
    btnAll.title = "Select all inputs";
    btnAll.addEventListener("click", (ev) => {
      ev.stopPropagation();
      selectAll();
    });

    const btnClear = document.createElement("button");
    btnClear.type = "button";
    btnClear.id = "btn-clear";
    btnClear.textContent = "Clear";
    btnClear.title = "Unselect all inputs";
    btnClear.addEventListener("click", (ev) => {
      ev.stopPropagation();
      clearSelection();
    });

    wrap.appendChild(btnAll);
    wrap.appendChild(btnClear);

    const toggle = document.getElementById("legend-toggle");
    if (toggle) header.insertBefore(wrap, toggle);
    else header.appendChild(wrap);
  }

  function buildLegend(data) {
    const body = document.getElementById("legend-body");
    if (!body) {
      console.error("buildLegend: #legend-body not found");
      return;
    }
    refreshLineColorOverridesForCurrentStem();
    body.innerHTML = "";

    const lines = Array.isArray(data.lines) ? data.lines : [];
    selectedLines = new Set(lines.map(l => l.id));

    lines.forEach(line => {
      const nUnpaired = (line.unpairedNodes || []).length;
      const item = document.createElement("div");
      item.className = "legend-item selected";
      item.dataset.lineId = line.id;

      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = metroLineColor(line);

      const label = document.createElement("span");
      label.className = "legend-label";
      const extra = nUnpaired > 0 ? `, ${nUnpaired} unpaired` : "";
      label.textContent =
        `${line.name} (${line.matchedNodes.length} nodes${extra})`;

      item.appendChild(swatch);
      item.appendChild(label);
      body.appendChild(item);

      item.addEventListener("mouseenter", () => highlightLine(line.id));
      item.addEventListener("mouseleave", () => clearHighlight());
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleLineSelection(line.id);
      });
    });

    const header = document.getElementById("legend-header");
    if (header) {
      header.onclick = (ev) => {
        if (ev.target.closest("#legend-header-actions")) return;
        const panel = document.getElementById("legend-panel");
        const toggle = document.getElementById("legend-toggle");
        if (panel) panel.classList.toggle("collapsed");
        if (toggle) {
          toggle.textContent =
            panel && panel.classList.contains("collapsed")
              ? "\u25C0" : "\u25B6";
        }
      };
    }

    buildToolbar();
    syncLegendUI();
  }

  function buildToolbar() {
    setupLegendHeaderActions();

    let toolbar = document.getElementById("legend-toolbar");
    if (toolbar) toolbar.remove();

    toolbar = document.createElement("div");
    toolbar.id = "legend-toolbar";

    // Edge mode toggle (Bundled / Metro)
    const edgeBtnGroup = document.createElement("span");
    edgeBtnGroup.className = "btn-group-edge";

    const btnBundled = document.createElement("button");
    btnBundled.id = "btn-edge-bundled";
    btnBundled.textContent = "Bundled";
    btnBundled.title = "Single edge with thickness = popularity";
    btnBundled.className = edgeMode === "bundled" ? "active" : "";

    const btnMetro = document.createElement("button");
    btnMetro.id = "btn-edge-metro";
    btnMetro.textContent = "Metro";
    btnMetro.title = "Parallel colored stripes per input";
    btnMetro.className = edgeMode === "metro" ? "active" : "";

    btnBundled.addEventListener("click", () => {
      if (edgeMode === "bundled") return;
      edgeMode = "bundled";
      btnBundled.classList.add("active");
      btnMetro.classList.remove("active");
      renderEdges();
      applySelection();
    });
    btnMetro.addEventListener("click", () => {
      if (edgeMode === "metro") return;
      edgeMode = "metro";
      btnMetro.classList.add("active");
      btnBundled.classList.remove("active");
      renderEdges();
      applySelection();
    });

    edgeBtnGroup.appendChild(btnBundled);
    edgeBtnGroup.appendChild(btnMetro);
    toolbar.appendChild(edgeBtnGroup);

    const sepHide = document.createElement("span");
    sepHide.className = "toolbar-sep";
    toolbar.appendChild(sepHide);

    const hideWrap = document.createElement("label");
    hideWrap.className = "toggle-wrap";
    hideWrap.title =
      "Hide barycenter nodes with zero substantial coupling matches across all inputs";

    const hideCb = document.createElement("input");
    hideCb.type = "checkbox";
    hideCb.id = "cb-hide-zero-substantial";
    hideCb.checked = hideZeroSubstantialNodes;
    hideCb.addEventListener("change", () => {
      hideZeroSubstantialNodes = hideCb.checked;
      persistHideZeroSubstantialNodesPref();
      if (data) render(data);
    });

    const hideSlider = document.createElement("span");
    hideSlider.className = "toggle-slider";

    const hideLabel = document.createElement("span");
    hideLabel.className = "toggle-text";
    hideLabel.textContent = "Hide 0-match";

    hideWrap.appendChild(hideCb);
    hideWrap.appendChild(hideSlider);
    hideWrap.appendChild(hideLabel);
    toolbar.appendChild(hideWrap);

    // Separator
    const sep = document.createElement("span");
    sep.className = "toolbar-sep";
    toolbar.appendChild(sep);

    const toggleWrap = document.createElement("label");
    toggleWrap.className = "toggle-wrap";
    toggleWrap.title = "Allow selecting multiple inputs at once";

    const toggleCb = document.createElement("input");
    toggleCb.type = "checkbox";
    toggleCb.id = "cb-multi-select";
    toggleCb.checked = multiSelect;
    toggleCb.addEventListener("change", () => {
      multiSelect = toggleCb.checked;
      updateInputTreePanel();
      syncInputTreeHint();
    });

    const slider = document.createElement("span");
    slider.className = "toggle-slider";

    const toggleLabel = document.createElement("span");
    toggleLabel.className = "toggle-text";
    toggleLabel.textContent = "Multi";

    toggleWrap.appendChild(toggleCb);
    toggleWrap.appendChild(slider);
    toggleWrap.appendChild(toggleLabel);

    toolbar.appendChild(toggleWrap);

    const sepEven = document.createElement("span");
    sepEven.className = "toolbar-sep";
    toolbar.appendChild(sepEven);

    const evenWrap = document.createElement("label");
    evenWrap.className = "toggle-wrap";
    evenWrap.title =
      "Evenly space distinct vertical x-columns (reduces crowded subtrees)";

    const evenCb = document.createElement("input");
    evenCb.type = "checkbox";
    evenCb.id = "cb-even-x";
    evenCb.checked = evenXDistribution;
    evenCb.addEventListener("change", () => {
      evenXDistribution = evenCb.checked;
      if (data) render(data);
    });

    const evenSlider = document.createElement("span");
    evenSlider.className = "toggle-slider";

    const evenLabel = document.createElement("span");
    evenLabel.className = "toggle-text";
    evenLabel.textContent = "Even X";

    evenWrap.appendChild(evenCb);
    evenWrap.appendChild(evenSlider);
    evenWrap.appendChild(evenLabel);
    toolbar.appendChild(evenWrap);

    const sepXScale = document.createElement("span");
    sepXScale.className = "toolbar-sep";
    toolbar.appendChild(sepXScale);

    const xScaleWrap = document.createElement("span");
    xScaleWrap.className = "toolbar-node-colors";

    const xScaleLab = document.createElement("label");
    xScaleLab.className = "toolbar-inline-label";
    xScaleLab.setAttribute("for", "rng-layout-scale-x");
    xScaleLab.textContent = "X scale";

    const xScaleRange = document.createElement("input");
    xScaleRange.type = "range";
    xScaleRange.id = "rng-layout-scale-x";
    xScaleRange.min = "0.6";
    xScaleRange.max = "4.0";
    xScaleRange.step = "0.05";
    xScaleRange.value = String(layoutScaleXUser);
    xScaleRange.title = "Compress/expand barycenter map horizontally for screenshots";

    const xScaleVal = document.createElement("span");
    xScaleVal.className = "toolbar-inline-label";
    xScaleVal.style.minWidth = "2.6em";
    xScaleVal.style.textAlign = "right";
    xScaleVal.textContent = Number(layoutScaleXUser).toFixed(2);

    xScaleRange.addEventListener("input", () => {
      const v = Number(xScaleRange.value);
      if (!Number.isFinite(v) || v <= 0) return;
      layoutScaleXUser = v;
      xScaleVal.textContent = v.toFixed(2);
      persistLayoutScaleXPref();
      if (data) render(data);
    });

    xScaleWrap.appendChild(xScaleLab);
    xScaleWrap.appendChild(xScaleRange);
    xScaleWrap.appendChild(xScaleVal);
    toolbar.appendChild(xScaleWrap);

    const sepUnc = document.createElement("span");
    sepUnc.className = "toolbar-sep";
    toolbar.appendChild(sepUnc);

    const uncWrap = document.createElement("span");
    uncWrap.className = "toolbar-node-colors";

    const uncLab = document.createElement("label");
    uncLab.className = "toolbar-inline-label";
    uncLab.setAttribute("for", "sel-bary-uncertainty-mode");
    uncLab.textContent = "Uncertainty";

    const selUnc = document.createElement("select");
    selUnc.id = "sel-bary-uncertainty-mode";
    selUnc.title =
      "Inside the coord-uncertainty ellipse: σ of matched heights across " +
      "selected inputs, or Shannon entropy of thresholded coupling row masses.";

    const uncOpts = [
      ["functionVariation", "\u03c3 (matched heights)"],
      ["probabilistic", "H (coupling masses)"],
    ];
    for (let oi = 0; oi < uncOpts.length; oi++) {
      const opt = document.createElement("option");
      opt.value = uncOpts[oi][0];
      opt.textContent = uncOpts[oi][1];
      selUnc.appendChild(opt);
    }
    selUnc.value =
      CONFIG.baryNodeUncertaintyMode === "probabilistic"
        ? "probabilistic"
        : "functionVariation";

    selUnc.addEventListener("change", () => {
      const v = selUnc.value;
      CONFIG.baryNodeUncertaintyMode =
        v === "probabilistic" ? "probabilistic" : "functionVariation";
      persistBaryUncertaintyMode();
      if (data) render(data);
    });

    uncWrap.appendChild(uncLab);
    uncWrap.appendChild(selUnc);
    toolbar.appendChild(uncWrap);

    const sepCol = document.createElement("span");
    sepCol.className = "toolbar-sep";
    toolbar.appendChild(sepCol);

    const nodeColorWrap = document.createElement("span");
    nodeColorWrap.className = "toolbar-node-colors";

    const colLab = document.createElement("label");
    colLab.className = "toolbar-inline-label";
    colLab.setAttribute("for", "sel-bary-node-colors");
    colLab.textContent = "Node colors";

    const selColors = document.createElement("select");
    selColors.id = "sel-bary-node-colors";
    selColors.title =
      "Default fill before per-node edits: JSON colors from the dataset, or a large " +
      "categorical palette (discrete colors that repeat by node index).";

    const colorSchemeOpts = [
      ["file", "Prepared (JSON)"],
      ["categorical", "Categorical palette"],
    ];
    for (let oi = 0; oi < colorSchemeOpts.length; oi++) {
      const opt = document.createElement("option");
      opt.value = colorSchemeOpts[oi][0];
      opt.textContent = colorSchemeOpts[oi][1];
      selColors.appendChild(opt);
    }
    selColors.value =
      nodeColorScheme === "file" || nodeColorScheme === "categorical"
        ? nodeColorScheme
        : "file";

    const btnClearColors = document.createElement("button");
    btnClearColors.type = "button";
    btnClearColors.className = "toolbar-clear-node-colors";
    btnClearColors.textContent = "Clear node colors";
    btnClearColors.title =
      "Remove all per-node color overrides for this dataset (defaults only)";

    function commitNodeColorsAndRedraw() {
      try {
        localStorage.setItem(LS_NODE_COLOR_SCHEME, nodeColorScheme);
      } catch (e) { /* ignore */ }
      if (data) render(data);
      if (_lastInputTreePayload && shouldShowInputTreePanel()) {
        drawInputTreeSvg(
          _lastInputTreePayload.tree,
          _lastInputTreePayload.inputIdx);
      }
    }

    selColors.addEventListener("change", () => {
      nodeColorScheme = selColors.value;
      if (nodeColorScheme !== "file" && nodeColorScheme !== "categorical") {
        nodeColorScheme = "file";
      }
      commitNodeColorsAndRedraw();
    });

    btnClearColors.addEventListener("click", (ev) => {
      ev.preventDefault();
      clearAllNodeColorOverridesForCurrentStem();
      commitNodeColorsAndRedraw();
      if (_selectedDetailNodeId !== null &&
          _selectedDetailNodeId !== undefined) {
        renderNodePanel();
      }
    });

    nodeColorWrap.appendChild(colLab);
    nodeColorWrap.appendChild(selColors);
    nodeColorWrap.appendChild(btnClearColors);
    toolbar.appendChild(nodeColorWrap);

    const sepLine = document.createElement("span");
    sepLine.className = "toolbar-sep";
    toolbar.appendChild(sepLine);

    const lineColorWrap = document.createElement("span");
    lineColorWrap.className = "toolbar-node-colors";

    const lineLab = document.createElement("label");
    lineLab.className = "toolbar-inline-label";
    lineLab.setAttribute("for", "sel-line-color-line");
    lineLab.textContent = "Line colors";

    const selLine = document.createElement("select");
    selLine.id = "sel-line-color-line";
    selLine.title = "Choose an input line; set a custom color for metro stripes and legend";
    if (data && Array.isArray(data.lines)) {
      for (let li = 0; li < data.lines.length; li++) {
        const l = data.lines[li];
        const opt = document.createElement("option");
        opt.value = String(l.id);
        opt.textContent = l.name || `Input ${l.id}`;
        selLine.appendChild(opt);
      }
    }

    const inpLineCol = document.createElement("input");
    inpLineCol.type = "color";
    inpLineCol.id = "inp-line-color-override";
    inpLineCol.title = "Custom color for the selected line";
    inpLineCol.style.width = "32px";
    inpLineCol.style.height = "22px";
    inpLineCol.style.padding = "0";
    inpLineCol.style.verticalAlign = "middle";

    function syncLineColorPickerFromSelect() {
      const lid = +selLine.value;
      if (!Number.isFinite(lid)) return;
      inpLineCol.value = toColorInputValue(metroLineColor(lid));
    }

    function commitLineColorsAndRedraw() {
      if (!data) return;
      buildLegend(data);
      render(data);
      if (_lastInputTreePayload && shouldShowInputTreePanel()) {
        drawInputTreeSvg(
          _lastInputTreePayload.tree,
          _lastInputTreePayload.inputIdx);
      }
    }

    selLine.addEventListener("change", () => syncLineColorPickerFromSelect());

    const btnApplyLine = document.createElement("button");
    btnApplyLine.type = "button";
    btnApplyLine.textContent = "Apply line color";
    btnApplyLine.title =
      "Save this color for the selected line (stored per dataset in the browser)";
    btnApplyLine.addEventListener("click", (ev) => {
      ev.preventDefault();
      const lid = +selLine.value;
      if (!Number.isFinite(lid)) return;
      const hex = inpLineCol.value;
      if (!/^#[0-9a-fA-F]{6}$/i.test(hex)) return;
      setLineColorOverrideForCurrentStem(lid, hex.toLowerCase());
      commitLineColorsAndRedraw();
    });

    const btnClearOneLine = document.createElement("button");
    btnClearOneLine.type = "button";
    btnClearOneLine.textContent = "Clear line color";
    btnClearOneLine.title = "Remove custom color for the selected line only";
    btnClearOneLine.addEventListener("click", (ev) => {
      ev.preventDefault();
      const lid = +selLine.value;
      if (!Number.isFinite(lid)) return;
      removeLineColorOverrideForCurrentStem(lid);
      commitLineColorsAndRedraw();
    });

    const btnClearAllLines = document.createElement("button");
    btnClearAllLines.type = "button";
    btnClearAllLines.className = "toolbar-clear-node-colors";
    btnClearAllLines.textContent = "Clear all line colors";
    btnClearAllLines.title =
      "Remove all line color overrides for this dataset (legend / metro stripes)";
    btnClearAllLines.addEventListener("click", (ev) => {
      ev.preventDefault();
      clearAllLineColorOverridesForCurrentStem();
      commitLineColorsAndRedraw();
    });

    lineColorWrap.appendChild(lineLab);
    lineColorWrap.appendChild(selLine);
    lineColorWrap.appendChild(inpLineCol);
    lineColorWrap.appendChild(btnApplyLine);
    lineColorWrap.appendChild(btnClearOneLine);
    lineColorWrap.appendChild(btnClearAllLines);
    toolbar.appendChild(lineColorWrap);

    if (selLine.options.length) {
      syncLineColorPickerFromSelect();
    }

    const legendBody = document.getElementById("legend-body");
    if (!legendBody || !legendBody.parentNode) {
      console.error("buildToolbar: #legend-body or parent missing");
      return;
    }
    legendBody.parentNode.insertBefore(toolbar, legendBody);
  }

  // ── Init ─────────────────────────────────────────────────────────

  function showMapError(msg) {
    const mc = document.getElementById("map-container");
    let el = document.getElementById("map-load-error");
    if (!el) {
      el = document.createElement("div");
      el.id = "map-load-error";
      el.style.cssText =
        "position:absolute;left:10px;bottom:10px;max-width:70%;" +
        "background:#fff5f5;border:1px solid #e03131;color:#c92a2a;" +
        "padding:10px 12px;z-index:30;border-radius:6px;font-size:13px;";
      mc.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = "block";
  }

  function clearMapError() {
    const el = document.getElementById("map-load-error");
    if (el) el.style.display = "none";
  }

  function wireNodePanelClose() {
    const closeBtn = document.getElementById("node-panel-close");
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.dataset.wired = "1";
      closeBtn.onclick = () => {
        _selectedDetailNodeId = null;
        _bundleCandidateIds = [];
        document.getElementById("node-panel")
          .classList.add("collapsed");
        syncMapStationDetailHighlight();
      };
    }
  }

  async function loadCurrentDataset() {
    const stem = getCurrentDatasetStem();
    if (!stem) return;
    clearMapError();
    try {
      localStorage.setItem("metroDatasetStem", stem);
      data = await loadDataset(stem);
    } catch (err) {
      console.error(err);
      showMapError(`Failed to load ${stem}.json — ${err.message}`);
      return;
    }

    buildLegend(data);
    render(data);
    wireNodePanelClose();
  }

  function onDatasetNameChange() {
    const nameSel = document.getElementById("dataset-name-select");
    if (!nameSel) return;
    fillEpsSelectForBase(nameSel.value);
    const epsSel = document.getElementById("dataset-eps-select");
    if (epsSel && epsSel.options.length) epsSel.selectedIndex = 0;
    fillBalanceSelectForBaseEps(nameSel.value, epsSel && epsSel.value ? epsSel.value : "");
    const balSel = document.getElementById("dataset-balance-select");
    if (balSel && balSel.options.length) balSel.selectedIndex = 0;
    loadCurrentDataset();
  }

  function onDatasetEpsChange() {
    const nameSel = document.getElementById("dataset-name-select");
    const epsSel = document.getElementById("dataset-eps-select");
    if (!nameSel || !epsSel) return;
    fillBalanceSelectForBaseEps(nameSel.value, epsSel.value);
    const balSel = document.getElementById("dataset-balance-select");
    if (balSel && balSel.options.length) balSel.selectedIndex = 0;
    loadCurrentDataset();
  }

  async function init() {
    if (window.location.protocol === "file:") {
      showMapError(
        "This page cannot load data when opened as a file (file://). " +
        "Run a local server from the metro_viz folder, e.g. " +
        "python -m http.server 8080, then open " +
        "http://localhost:8080/index.html");
      return;
    }
    try {
      loadNodeColorPrefs();
      loadBaryUncertaintyPrefs();
      loadHideZeroSubstantialNodesPref();
      loadLayoutScaleXPref();
      const { data: manifest, urlUsed } = await loadManifest();
      _allStems = (manifest.datasets || []).map(s => String(s).trim());
      setManifestStatusLine(
        `manifest OK (${_allStems.length} stems) — ${urlUsed}`
      );
      if (!_allStems.length) {
        showMapError(
          "No JSON datasets in data/. Run prepare_data.py or python refresh_manifest.py.");
        return;
      }
      _datasetGroups = groupDatasetsByBase(_allStems);
      fillDatasetNameSelect(_datasetGroups);

      const rawSaved = localStorage.getItem("metroDatasetStem");
      const saved = rawSaved ? rawSaved.trim() : "";
      let restored = false;
      if (saved && _allStems.includes(saved)) {
        restored = applyStemToSelectors(saved);
      }
      if (saved && !restored) {
        localStorage.removeItem("metroDatasetStem");
      }
      ensureDefaultDatasetSelection();

      if (!getCurrentDatasetStem()) {
        showMapError("Could not pick a dataset (empty ε/distribution list). Check manifest.json.");
        return;
      }

      await loadCurrentDataset();
      wireNodePanelClose();
    } catch (err) {
      console.error(err);
      showMapError(
        "Could not load data/manifest.json — " + err.message +
        ". Ensure metro_viz/data/manifest.json exists (run prepare_data.py " +
        "or python refresh_manifest.py) and use http:// not file://.");
    }
  }

  function wireDatasetSelects() {
    const bar = document.getElementById("dataset-bar");
    if (!bar) {
      console.error("metro.js: #dataset-bar not found in HTML.");
      return;
    }
    if (bar.dataset.changeWired === "1") return;
    bar.dataset.changeWired = "1";
    bar.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t || !t.id) return;
      if (t.id === "dataset-name-select") onDatasetNameChange();
      else if (t.id === "dataset-eps-select") onDatasetEpsChange();
      else if (t.id === "dataset-balance-select") loadCurrentDataset();
    });
  }

  const INPUT_TREE_PANEL_WIDTH_KEY = "metroInputTreePanelWidthPx";
  const INPUT_TREE_PANEL_WIDTH_DEFAULT = 340;
  const INPUT_TREE_PANEL_WIDTH_MIN = 200;

  function inputTreePanelWidthMaxPx() {
    return Math.min(900, Math.floor(window.innerWidth * 0.88));
  }

  function clampInputTreePanelWidth(px) {
    return Math.max(
      INPUT_TREE_PANEL_WIDTH_MIN,
      Math.min(inputTreePanelWidthMaxPx(), Math.round(px))
    );
  }

  function readStoredInputTreePanelWidth() {
    const raw = localStorage.getItem(INPUT_TREE_PANEL_WIDTH_KEY);
    if (raw == null) return INPUT_TREE_PANEL_WIDTH_DEFAULT;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? clampInputTreePanelWidth(n) : INPUT_TREE_PANEL_WIDTH_DEFAULT;
  }

  function applyInputTreePanelWidth(px) {
    const panel = document.getElementById("input-tree-panel");
    if (!panel) return;
    const w = clampInputTreePanelWidth(px);
    panel.style.width = w + "px";
    localStorage.setItem(INPUT_TREE_PANEL_WIDTH_KEY, String(w));
  }

  function wireInputTreePanelResize() {
    const panel = document.getElementById("input-tree-panel");
    const handle = document.getElementById("input-tree-resize-handle");
    if (!panel || !handle || handle.dataset.wired === "1") return;
    handle.dataset.wired = "1";
    applyInputTreePanelWidth(readStoredInputTreePanelWidth());

    let startX = 0;
    let startW = 0;

    function onMove(e) {
      const dw = startX - e.clientX;
      applyInputTreePanelWidth(startW + dw);
      e.preventDefault();
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (_lastInputTreePayload && shouldShowInputTreePanel()) {
        drawInputTreeSvg(_lastInputTreePayload.tree, _lastInputTreePayload.inputIdx);
      }
    }

    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startW = panel.getBoundingClientRect().width;
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    });

    handle.addEventListener("dblclick", (e) => {
      e.preventDefault();
      applyInputTreePanelWidth(INPUT_TREE_PANEL_WIDTH_DEFAULT);
      if (_lastInputTreePayload && shouldShowInputTreePanel()) {
        drawInputTreeSvg(_lastInputTreePayload.tree, _lastInputTreePayload.inputIdx);
      }
    });

    window.addEventListener("resize", () => {
      const w = parseInt(panel.style.width, 10);
      if (Number.isFinite(w)) applyInputTreePanelWidth(w);
    });
  }

  window.addEventListener("resize", () => { if (data) render(data); });

  function boot() {
    wireInputTreePanelResize();
    wireDatasetSelects();
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
