const SVG_NS = "http://www.w3.org/2000/svg";
const CARD = { width: 240, height: 112, siblingGap: 48, levelGap: 104, margin: 90 };
const RADIAL = { radiusStep: 230, startAngle: -Math.PI / 2, margin: 150 };
const CAMERA = { min: 0.08, max: 3.2 };

const $ = (selector) => document.querySelector(selector);
const elements = {
  app: $("#app"),
  runSelect: $("#run-select"),
  title: $("#run-title"),
  statement: $("#decision-statement"),
  completion: $("#completion-badge"),
  approval: $("#approval-badge"),
  stats: $("#run-stats"),
  search: $("#search-input"),
  searchCount: $("#search-count"),
  searchPrev: $("#search-prev"),
  searchNext: $("#search-next"),
  treeButton: $("#view-tree"),
  radialButton: $("#view-radial"),
  orientationControls: $("#orientation-controls"),
  tbButton: $("#orientation-tb"),
  lrButton: $("#orientation-lr"),
  focusButton: $("#focus-branch"),
  collapseButton: $("#toggle-collapse"),
  expandAllButton: $("#expand-all"),
  fitAllButton: $("#fit-all"),
  fitSelectionButton: $("#fit-selection"),
  zoomOutButton: $("#zoom-out"),
  zoomResetButton: $("#zoom-reset"),
  zoomInButton: $("#zoom-in"),
  zoomValue: $("#zoom-value"),
  helpButton: $("#help-button"),
  canvasFrame: $("#canvas-frame"),
  canvas: $("#decision-canvas"),
  viewport: $("#viewport"),
  edgeLayer: $("#edge-layer"),
  relationLayer: $("#relation-layer"),
  nodeLayer: $("#node-layer"),
  loading: $("#canvas-loading"),
  empty: $("#canvas-empty"),
  minimap: $("#minimap"),
  minimapEdges: $("#minimap-edges"),
  minimapNodes: $("#minimap-nodes"),
  minimapViewport: $("#minimap-viewport"),
  breadcrumbs: $("#breadcrumbs"),
  inspector: $("#inspector"),
  inspectorTitle: $("#inspector-title"),
  inspectorEmpty: $("#inspector-empty"),
  inspectorContent: $("#inspector-content"),
  inspectorSummary: $("#inspector-summary"),
  inspectorQuestion: $("#inspector-question"),
  inspectorEvaluation: $("#inspector-evaluation"),
  inspectorEvidence: $("#inspector-evidence"),
  inspectorProvenance: $("#inspector-provenance"),
  closeInspector: $("#close-inspector"),
  fatal: $("#fatal-error"),
  fatalMessage: $("#fatal-error-message"),
  retry: $("#retry-button"),
  help: $("#shortcuts-dialog"),
  closeHelp: $("#close-help"),
  live: $("#live-region"),
};

const state = {
  runs: [],
  bundle: null,
  runId: null,
  nodeById: new Map(),
  edgeByTarget: new Map(),
  edgesBySource: new Map(),
  childrenById: new Map(),
  rootId: null,
  selectedId: null,
  focusId: null,
  collapsed: new Set(),
  view: "tree",
  orientation: "tb",
  searchQuery: "",
  searchMatches: [],
  searchIndex: -1,
  positions: new Map(),
  visibleIds: new Set(),
  visibleChildren: new Map(),
  layoutBounds: { minX: 0, minY: 0, width: 1, height: 1 },
  camera: { x: 0, y: 0, scale: 1 },
  pan: null,
  spaceDown: false,
  loadingToken: 0,
};

function svgElement(name, attrs = {}, text = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = text;
  return node;
}

function htmlElement(name, className, text = null) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

function replaceChildren(target, children) {
  target.replaceChildren(...children.filter(Boolean));
}

function appendChildren(target, ...children) {
  target.append(...children.filter(Boolean));
}

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
}

function compactNumber(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) : "—";
}

function truncate(value, length = 30) {
  const source = text(value, "");
  return source.length <= length ? source : `${source.slice(0, Math.max(0, length - 1))}…`;
}

function normalize(value) {
  return String(value ?? "").normalize("NFKD").toLocaleLowerCase();
}

function flattenText(value, output = []) {
  if (value === null || value === undefined) return output;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    output.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) flattenText(item, output);
  } else if (typeof value === "object") {
    for (const item of Object.values(value)) flattenText(item, output);
  }
  return output;
}

function announce(message) {
  elements.live.textContent = "";
  requestAnimationFrame(() => { elements.live.textContent = message; });
}

function currentParams() {
  return new URLSearchParams(window.location.search);
}

function syncUrl(push = false) {
  if (!state.runId) return;
  const params = currentParams();
  params.set("run", state.runId);
  if (state.selectedId) params.set("node", state.selectedId); else params.delete("node");
  params.set("view", state.view);
  if (state.view === "tree") params.set("orientation", state.orientation); else params.delete("orientation");
  if (state.focusId) params.set("focus", state.focusId); else params.delete("focus");
  if (state.collapsed.size) params.set("collapsed", [...state.collapsed].sort().join(",")); else params.delete("collapsed");
  const next = `${window.location.pathname}?${params.toString()}`;
  window.history[push ? "pushState" : "replaceState"]({}, "", next);
}

function readUiParams() {
  const params = currentParams();
  return {
    runId: params.get("run"),
    selectedId: params.get("node"),
    focusId: params.get("focus"),
    view: params.get("view") === "radial" ? "radial" : "tree",
    orientation: params.get("orientation") === "lr" ? "lr" : "tb",
    collapsed: new Set((params.get("collapsed") || "").split(",").filter(Boolean)),
  };
}

function showError(error) {
  elements.loading.hidden = true;
  elements.fatalMessage.textContent = error instanceof Error ? error.message : String(error);
  elements.fatal.hidden = false;
  elements.app.setAttribute("aria-busy", "false");
}

function clearError() {
  elements.fatal.hidden = true;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    let detail = "";
    try { detail = `: ${await response.text()}`; } catch { /* no body */ }
    throw new Error(`${response.status} ${response.statusText}${detail}`);
  }
  return response.json();
}

async function loadRuns() {
  clearError();
  elements.app.setAttribute("aria-busy", "true");
  const runs = await getJson("/api/runs");
  if (!Array.isArray(runs)) throw new Error("GET /api/runs must return a JSON array.");
  state.runs = runs;
  replaceChildren(elements.runSelect, runs.map((run) => {
    const option = document.createElement("option");
    option.value = run.runId;
    option.textContent = `${run.title || run.runId}${run.completion ? ` · ${completionLabel(run.completion)}` : ""}`;
    return option;
  }));
  if (!runs.length) throw new Error("No decision runs were found.");
  const params = readUiParams();
  const requested = runs.some((run) => run.runId === params.runId) ? params.runId : runs[0].runId;
  await loadRun(requested, params);
}

function validateBundle(bundle) {
  if (!bundle || bundle.schemaVersion !== 1 || !bundle.run || !Array.isArray(bundle.nodes) || !Array.isArray(bundle.edges)) {
    throw new Error("GET /api/runs/:id returned an invalid DecisionViewerBundleV1.");
  }
  const ids = new Set(bundle.nodes.map((node) => node.id));
  if (ids.size !== bundle.nodes.length) throw new Error("Viewer bundle contains duplicate branch IDs.");
  const roots = bundle.nodes.filter((node) => node.parentId === null);
  if (bundle.nodes.length && roots.length !== 1) throw new Error(`Viewer bundle must contain exactly one root; found ${roots.length}.`);
  for (const node of bundle.nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) throw new Error(`Branch ${node.id} references missing parent ${node.parentId}.`);
  }
  for (const edge of bundle.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) throw new Error(`Answer edge ${edge.id} references an unknown branch.`);
  }
}

async function loadRun(runId, ui = readUiParams()) {
  const token = ++state.loadingToken;
  clearError();
  elements.loading.hidden = false;
  elements.empty.hidden = true;
  elements.app.setAttribute("aria-busy", "true");
  const bundle = await getJson(`/api/runs/${encodeURIComponent(runId)}`);
  if (token !== state.loadingToken) return;
  validateBundle(bundle);
  state.bundle = bundle;
  state.runId = bundle.run.runId;
  state.nodeById = new Map(bundle.nodes.map((node) => [node.id, node]));
  state.edgeByTarget = new Map(bundle.edges.map((edge) => [edge.target, edge]));
  state.edgesBySource = new Map();
  for (const edge of bundle.edges) {
    const list = state.edgesBySource.get(edge.source) || [];
    list.push(edge);
    state.edgesBySource.set(edge.source, list);
  }
  for (const list of state.edgesBySource.values()) {
    list.sort((a, b) => a.optionOrdinal - b.optionOrdinal || a.target.localeCompare(b.target));
  }
  state.childrenById = new Map(bundle.nodes.map((node) => [node.id, (state.edgesBySource.get(node.id) || []).map((edge) => edge.target)]));
  state.rootId = bundle.nodes.find((node) => node.parentId === null)?.id || null;
  state.selectedId = state.nodeById.has(ui.selectedId) ? ui.selectedId : null;
  state.focusId = state.nodeById.has(ui.focusId) ? ui.focusId : null;
  state.view = ui.view === "radial" ? "radial" : "tree";
  state.orientation = ui.orientation === "lr" ? "lr" : "tb";
  state.collapsed = new Set([...ui.collapsed].filter((id) => state.nodeById.has(id)));
  state.searchQuery = "";
  state.searchMatches = [];
  state.searchIndex = -1;
  elements.search.value = "";
  elements.runSelect.value = state.runId;
  renderRunMeta();
  render({ fit: true });
  elements.loading.hidden = true;
  elements.empty.hidden = bundle.nodes.length !== 0;
  elements.app.setAttribute("aria-busy", "false");
  syncUrl();
  announce(`Loaded ${bundle.run.title} with ${bundle.nodes.length} branches.`);
}

function completionLabel(value) {
  const labels = {
    in_progress: "In progress",
    coverage_complete: "Coverage complete",
    partial_budget_exhausted: "Partial · budget",
    partial_safety_limit: "Partial · safety",
    partial_failure: "Partial · failure",
  };
  return labels[value] || text(value).replaceAll("_", " ");
}

function completionClass(value) {
  if (value === "coverage_complete") return "status-complete";
  if (value === "in_progress") return "status-open";
  if (value === "partial_failure") return "status-failed";
  return "status-partial";
}

function renderRunMeta() {
  const { run, summary } = state.bundle;
  document.title = `${run.title} · Decision Tree Viewer`;
  elements.title.textContent = run.title;
  elements.statement.textContent = run.decisionStatement;
  elements.completion.className = `status-badge ${completionClass(run.completion)}`;
  elements.completion.textContent = completionLabel(run.completion);
  const approvalStatus = run.approval?.status || "awaiting_human_approval";
  elements.approval.className = `status-badge ${approvalStatus === "approved" ? "status-complete" : approvalStatus === "rejected" ? "status-failed" : "status-neutral"}`;
  elements.approval.textContent = approvalStatus.replaceAll("_", " ");
  const stats = [
    ["Branches", summary.branchCount],
    ["Questions", summary.questionCount],
    ["Depth", summary.maxDepth],
    ["Winner", percent(summary.winningAdjustedScore)],
  ];
  replaceChildren(elements.stats, stats.map(([label, value]) => {
    const wrapper = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = text(value);
    wrapper.append(dt, dd);
    return wrapper;
  }));
}

function ancestors(id) {
  const result = [];
  const seen = new Set();
  let current = state.nodeById.get(id);
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    result.push(current.id);
    current = current.parentId ? state.nodeById.get(current.parentId) : null;
  }
  return result.reverse();
}

function descendants(id, includeSelf = false) {
  const result = [];
  const stack = includeSelf ? [id] : [...(state.childrenById.get(id) || [])].reverse();
  while (stack.length) {
    const current = stack.pop();
    if (!state.nodeById.has(current)) continue;
    result.push(current);
    const children = state.childrenById.get(current) || [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return result;
}

function hiddenDescendantCount(id) {
  return descendants(id).length;
}

function deriveVisibleTree() {
  const visible = new Set();
  const visibleChildren = new Map();
  if (!state.rootId) return { visible, visibleChildren };
  const focusAncestors = state.focusId ? new Set(ancestors(state.focusId)) : null;
  const focusDescendants = state.focusId ? new Set(descendants(state.focusId, true)) : null;
  const allowed = (id) => !state.focusId || focusAncestors.has(id) || focusDescendants.has(id);
  const stack = [state.rootId];
  while (stack.length) {
    const id = stack.pop();
    if (!allowed(id)) continue;
    visible.add(id);
    if (state.collapsed.has(id)) {
      visibleChildren.set(id, []);
      continue;
    }
    let children = state.childrenById.get(id) || [];
    if (state.focusId && focusAncestors.has(id) && id !== state.focusId) {
      children = children.filter((child) => focusAncestors.has(child));
    } else {
      children = children.filter(allowed);
    }
    visibleChildren.set(id, children);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return { visible, visibleChildren };
}

function layoutTree(visibleChildren) {
  const positions = new Map();
  if (!state.rootId) return positions;
  const interval = new Map();
  let slot = 0;
  const stack = [[state.rootId, false]];
  while (stack.length) {
    const [id, visited] = stack.pop();
    const children = visibleChildren.get(id) || [];
    if (!visited) {
      stack.push([id, true]);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push([children[index], false]);
      continue;
    }
    if (!children.length) {
      interval.set(id, [slot, slot]);
      slot += 1;
    } else {
      const first = interval.get(children[0]);
      const last = interval.get(children[children.length - 1]);
      interval.set(id, [first[0], last[1]]);
    }
  }
  const rootDepth = state.nodeById.get(state.rootId)?.depth || 0;
  for (const id of state.visibleIds) {
    const node = state.nodeById.get(id);
    const [first, last] = interval.get(id) || [0, 0];
    const cross = CARD.margin + ((first + last) / 2) * (CARD.width + CARD.siblingGap);
    const depth = node.depth - rootDepth;
    if (state.orientation === "tb") {
      positions.set(id, { x: cross - CARD.width / 2, y: CARD.margin + depth * (CARD.height + CARD.levelGap), width: CARD.width, height: CARD.height });
    } else {
      const y = CARD.margin + ((first + last) / 2) * (CARD.height + CARD.siblingGap);
      positions.set(id, { x: CARD.margin + depth * (CARD.width + CARD.levelGap), y: y - CARD.height / 2, width: CARD.width, height: CARD.height });
    }
  }
  return positions;
}

function layoutRadial(visibleChildren) {
  const positions = new Map();
  if (!state.rootId) return positions;
  const interval = new Map();
  let slot = 0;
  const stack = [[state.rootId, false]];
  while (stack.length) {
    const [id, visited] = stack.pop();
    const children = visibleChildren.get(id) || [];
    if (!visited) {
      stack.push([id, true]);
      for (let index = children.length - 1; index >= 0; index -= 1) stack.push([children[index], false]);
    } else if (!children.length) {
      interval.set(id, [slot, slot]);
      slot += 1;
    } else {
      interval.set(id, [interval.get(children[0])[0], interval.get(children[children.length - 1])[1]]);
    }
  }
  const leafCount = Math.max(1, slot);
  const rootDepth = state.nodeById.get(state.rootId)?.depth || 0;
  const raw = [];
  for (const id of state.visibleIds) {
    const node = state.nodeById.get(id);
    const [first, last] = interval.get(id) || [0, 0];
    const angle = RADIAL.startAngle + (2 * Math.PI * (((first + last) / 2) + 0.5)) / leafCount;
    const radius = (node.depth - rootDepth) * RADIAL.radiusStep;
    const cx = radius === 0 ? 0 : Math.cos(angle) * radius;
    const cy = radius === 0 ? 0 : Math.sin(angle) * radius;
    raw.push({ id, x: cx - CARD.width / 2, y: cy - CARD.height / 2, width: CARD.width, height: CARD.height });
  }
  const minX = Math.min(...raw.map((item) => item.x), 0);
  const minY = Math.min(...raw.map((item) => item.y), 0);
  for (const item of raw) positions.set(item.id, { ...item, x: item.x - minX + RADIAL.margin, y: item.y - minY + RADIAL.margin });
  return positions;
}

function computeBounds(positions) {
  if (!positions.size) return { minX: 0, minY: 0, width: 1, height: 1 };
  const values = [...positions.values()];
  const minX = Math.min(...values.map((position) => position.x)) - 70;
  const minY = Math.min(...values.map((position) => position.y)) - 70;
  const maxX = Math.max(...values.map((position) => position.x + position.width)) + 70;
  const maxY = Math.max(...values.map((position) => position.y + position.height)) + 70;
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function edgePath(source, target) {
  if (state.view === "radial") {
    const sx = source.x + source.width / 2;
    const sy = source.y + source.height / 2;
    const tx = target.x + target.width / 2;
    const ty = target.y + target.height / 2;
    const cx = state.positions.get(state.rootId).x + CARD.width / 2;
    const cy = state.positions.get(state.rootId).y + CARD.height / 2;
    return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
  }
  if (state.orientation === "tb") {
    const sx = source.x + source.width / 2;
    const sy = source.y + source.height;
    const tx = target.x + target.width / 2;
    const ty = target.y;
    const middle = (sy + ty) / 2;
    return `M ${sx} ${sy} V ${middle} H ${tx} V ${ty}`;
  }
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const middle = (sx + tx) / 2;
  return `M ${sx} ${sy} H ${middle} V ${ty} H ${tx}`;
}

function edgeLabelPosition(source, target) {
  if (state.view === "radial") {
    return { x: (source.x + source.width / 2 + target.x + target.width / 2) / 2, y: (source.y + source.height / 2 + target.y + target.height / 2) / 2 };
  }
  if (state.orientation === "tb") return { x: target.x + target.width / 2, y: source.y + source.height + (target.y - source.y - source.height) * 0.5 };
  return { x: source.x + source.width + (target.x - source.x - source.width) * 0.5, y: target.y + target.height / 2 };
}

function selectedPathSet() {
  return new Set(state.selectedId ? ancestors(state.selectedId) : []);
}

function render({ fit = false, preserve = false } = {}) {
  if (!state.bundle) return;
  let anchor = null;
  if (preserve && state.selectedId && state.positions.has(state.selectedId)) {
    const old = state.positions.get(state.selectedId);
    anchor = { x: (old.x + old.width / 2) * state.camera.scale + state.camera.x, y: (old.y + old.height / 2) * state.camera.scale + state.camera.y };
  }
  const visible = deriveVisibleTree();
  state.visibleIds = visible.visible;
  state.visibleChildren = visible.visibleChildren;
  state.positions = state.view === "radial" ? layoutRadial(visible.visibleChildren) : layoutTree(visible.visibleChildren);
  state.layoutBounds = computeBounds(state.positions);
  if (anchor && state.positions.has(state.selectedId)) {
    const next = state.positions.get(state.selectedId);
    state.camera.x = anchor.x - (next.x + next.width / 2) * state.camera.scale;
    state.camera.y = anchor.y - (next.y + next.height / 2) * state.camera.scale;
  }
  renderGraph();
  renderMinimap();
  renderToolbarState();
  renderBreadcrumbs();
  renderInspector();
  if (fit) requestAnimationFrame(fitAll);
  else updateCamera();
}

function renderGraph() {
  const selectedPath = selectedPathSet();
  const edgeNodes = [];
  const nodeNodes = [];
  for (const edge of state.bundle.edges) {
    if (!state.visibleIds.has(edge.source) || !state.visibleIds.has(edge.target)) continue;
    const source = state.positions.get(edge.source);
    const target = state.positions.get(edge.target);
    const pathSelected = selectedPath.has(edge.source) && selectedPath.has(edge.target);
    const classes = ["answer-edge"];
    if (edge.flags?.isLocalRecommendation) classes.push("is-local");
    if (edge.flags?.isHindsightChoice) classes.push("is-hindsight");
    if (edge.flags?.isOnWinningPath) classes.push("is-winning");
    if (pathSelected) classes.push("is-selected-path");
    edgeNodes.push(svgElement("path", { d: edgePath(source, target), class: classes.join(" "), "data-edge-id": edge.id }));
    const location = edgeLabelPosition(source, target);
    const icons = `${edge.flags?.isLocalRecommendation ? "★" : ""}${edge.flags?.isHindsightChoice ? "◆" : ""}`;
    const labelText = `${icons ? `${icons} ` : ""}${truncate(edge.label, 22)}`;
    const width = Math.max(54, Math.min(164, labelText.length * 6.2 + 14));
    const labelClass = ["edge-label"];
    if (edge.flags?.isHindsightChoice) labelClass.push("is-hindsight");
    if (edge.flags?.isOnWinningPath) labelClass.push("is-winning");
    const label = svgElement("g", { class: labelClass.join(" "), transform: `translate(${location.x - width / 2} ${location.y - 10})` });
    label.append(svgElement("rect", { width, height: 20, rx: 8 }), svgElement("text", { x: width / 2, y: 13, "text-anchor": "middle" }, labelText));
    label.setAttribute("role", "button");
    label.setAttribute("aria-label", `Inspect answer ${edge.label}`);
    label.setAttribute("tabindex", "0");
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      revealAndSelect(edge.target);
    });
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        revealAndSelect(edge.target);
      }
    });
    edgeNodes.push(label);
  }
  for (const id of state.visibleIds) nodeNodes.push(renderNode(state.nodeById.get(id), state.positions.get(id), selectedPath));
  replaceChildren(elements.edgeLayer, edgeNodes);
  replaceChildren(elements.nodeLayer, nodeNodes);
  renderSemanticRelations();
  elements.empty.hidden = state.visibleIds.size > 0;
}

function renderSemanticRelations() {
  if (state.view !== "radial" || !Array.isArray(state.bundle.relations)) {
    elements.relationLayer.replaceChildren();
    return;
  }
  replaceChildren(elements.relationLayer, state.bundle.relations.filter((relation) => state.visibleIds.has(relation.source) && state.visibleIds.has(relation.target)).map((relation) => {
    const source = state.positions.get(relation.source);
    const target = state.positions.get(relation.target);
    return svgElement("path", {
      d: `M ${source.x + CARD.width / 2} ${source.y + CARD.height / 2} Q ${(source.x + target.x) / 2} ${(source.y + target.y) / 2 - 40} ${target.x + CARD.width / 2} ${target.y + CARD.height / 2}`,
      fill: "none",
      stroke: "var(--accent)",
      "stroke-dasharray": "4 8",
      "stroke-opacity": "0.22",
      "stroke-width": "1.5",
      "vector-effect": "non-scaling-stroke",
    });
  }));
}

function nodeKindLabel(kind) {
  return { question: "Question", conclusion: "Conclusion", boundary: "Boundary", open: "Open", failed: "Failed" }[kind] || text(kind);
}

function nodeScoreLine(node) {
  if (node.score?.state === "scored_leaf") return `Score ${percent(node.score.adjusted)} · confidence ${percent(node.score.confidence)}`;
  const subtree = node.score?.subtree;
  if (subtree) return `Best ${percent(subtree.best)} · mean ${percent(subtree.mean)} · worst ${percent(subtree.worst)}`;
  return `Score unknown · ${text(node.score?.absentReason, "not evaluated").replaceAll("_", " ")}`;
}

function renderNode(node, position, selectedPath) {
  const classes = ["branch-node", `kind-${node.kind}`];
  if (node.id === state.selectedId) classes.push("is-selected");
  if (node.flags?.isOnWinningPath) classes.push("is-winning");
  if (state.searchMatches.includes(node.id)) classes.push("is-search-match");
  const group = svgElement("g", {
    class: classes.join(" "),
    transform: `translate(${position.x} ${position.y})`,
    tabindex: "0",
    role: "treeitem",
    "aria-level": node.depth + 1,
    "aria-selected": node.id === state.selectedId ? "true" : "false",
    "aria-expanded": (state.childrenById.get(node.id) || []).length ? String(!state.collapsed.has(node.id)) : null,
    "aria-label": `${nodeKindLabel(node.kind)}: ${node.label}. ${nodeScoreLine(node)}`,
    "data-node-id": node.id,
  });
  group.append(svgElement("rect", { class: "node-card", width: CARD.width, height: CARD.height, rx: 12 }));
  group.append(svgElement("circle", { class: "node-kind-dot", cx: 15, cy: 16, r: 4 }));
  const incoming = node.incomingAnswer?.optionLabel || (node.flags?.isRoot ? "Decision root" : nodeKindLabel(node.kind));
  group.append(svgElement("text", { class: "node-kicker", x: 25, y: 19 }, truncate(incoming, 34)));
  const title = node.shortLabel || node.label;
  const lines = wrapText(title, 36, 3);
  lines.forEach((line, index) => group.append(svgElement("text", { class: "node-title", x: 14, y: 42 + index * 16 }, line)));
  group.append(svgElement("text", { class: "node-score", x: 14, y: 97 }, truncate(nodeScoreLine(node), 46)));
  const kindWidth = Math.max(48, nodeKindLabel(node.kind).length * 5.5 + 12);
  group.append(svgElement("rect", { class: "node-badge-bg", x: CARD.width - kindWidth - 10, y: 8, width: kindWidth, height: 18, rx: 8 }));
  group.append(svgElement("text", { class: "node-badge", x: CARD.width - kindWidth / 2 - 10, y: 20, "text-anchor": "middle" }, nodeKindLabel(node.kind)));
  if (node.question?.hindsight?.changedLocalRecommendation) {
    group.append(svgElement("rect", { class: "hindsight-change-bg", x: CARD.width - 113, y: 82, width: 103, height: 20, rx: 8 }));
    group.append(svgElement("text", { class: "hindsight-change-text", x: CARD.width - 61.5, y: 95, "text-anchor": "middle" }, "CHANGED BY HINDSIGHT"));
  }
  const children = state.childrenById.get(node.id) || [];
  if (children.length) {
    const collapsed = state.collapsed.has(node.id);
    const controlX = state.orientation === "lr" && state.view === "tree" ? CARD.width : CARD.width / 2;
    const controlY = state.orientation === "lr" && state.view === "tree" ? CARD.height / 2 : CARD.height;
    const control = svgElement("g", { class: "collapse-control", transform: `translate(${controlX} ${controlY})`, role: "button", "aria-label": `${collapsed ? "Expand" : "Collapse"} ${node.label}`, tabindex: "-1" });
    control.append(svgElement("circle", { r: 10 }), svgElement("text", { x: 0, y: 5, "text-anchor": "middle" }, collapsed ? "+" : "−"));
    control.addEventListener("click", (event) => { event.stopPropagation(); toggleCollapse(node.id); });
    group.append(control);
    if (collapsed) group.append(svgElement("text", { class: "node-collapsed", x: CARD.width / 2, y: CARD.height - 9, "text-anchor": "middle" }, `+${hiddenDescendantCount(node.id)} hidden branches`));
  }
  group.addEventListener("click", (event) => {
    event.stopPropagation();
    selectNode(node.id, { center: false, push: true });
  });
  group.addEventListener("dblclick", (event) => {
    event.preventDefault();
    toggleCollapse(node.id);
  });
  group.addEventListener("focus", () => {
    if (state.selectedId !== node.id) selectNode(node.id, { center: false, push: false });
  });
  return group;
}

function wrapText(value, columns, maxLines) {
  const words = String(value || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current || `${current} ${word}`.length <= columns) current = current ? `${current} ${word}` : word;
    else { lines.push(current); current = word; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (words.join(" ").length > lines.join(" ").length && lines.length) lines[lines.length - 1] = truncate(lines[lines.length - 1], columns);
  return lines.length ? lines : ["Untitled branch"];
}

function renderToolbarState() {
  const isTree = state.view === "tree";
  elements.treeButton.classList.toggle("is-active", isTree);
  elements.treeButton.setAttribute("aria-pressed", String(isTree));
  elements.radialButton.classList.toggle("is-active", !isTree);
  elements.radialButton.setAttribute("aria-pressed", String(!isTree));
  elements.orientationControls.hidden = !isTree;
  elements.tbButton.classList.toggle("is-active", state.orientation === "tb");
  elements.lrButton.classList.toggle("is-active", state.orientation === "lr");
  elements.tbButton.setAttribute("aria-pressed", String(state.orientation === "tb"));
  elements.lrButton.setAttribute("aria-pressed", String(state.orientation === "lr"));
  elements.focusButton.disabled = !state.selectedId;
  elements.focusButton.setAttribute("aria-pressed", String(Boolean(state.focusId)));
  elements.focusButton.textContent = state.focusId ? "Unfocus" : "Focus";
  const selectedChildren = state.selectedId ? state.childrenById.get(state.selectedId) || [] : [];
  elements.collapseButton.disabled = !selectedChildren.length;
  elements.collapseButton.textContent = state.selectedId && state.collapsed.has(state.selectedId) ? "Expand" : "Collapse";
  elements.expandAllButton.disabled = !state.collapsed.size;
  elements.fitSelectionButton.disabled = !state.selectedId;
  elements.searchPrev.disabled = !state.searchMatches.length;
  elements.searchNext.disabled = !state.searchMatches.length;
  elements.searchCount.textContent = state.searchMatches.length ? `${Math.max(0, state.searchIndex) + 1} / ${state.searchMatches.length}` : "0 / 0";
}

function applyCamera() {
  elements.viewport.setAttribute("transform", `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.scale})`);
  elements.zoomValue.textContent = `${Math.round(state.camera.scale * 100)}%`;
  elements.canvas.classList.toggle("is-overview", state.camera.scale < 0.48);
  elements.canvas.classList.toggle("is-distant", state.camera.scale < 0.24);
  updateMinimapViewport();
}

function updateCamera() {
  state.camera.scale = Math.max(CAMERA.min, Math.min(CAMERA.max, state.camera.scale));
  applyCamera();
}

function fitAll() {
  const frame = elements.canvasFrame.getBoundingClientRect();
  if (!frame.width || !frame.height) return;
  const bounds = state.layoutBounds;
  const scale = Math.max(CAMERA.min, Math.min(1, Math.min((frame.width - 34) / bounds.width, (frame.height - 34) / bounds.height)));
  state.camera = {
    scale,
    x: (frame.width - bounds.width * scale) / 2 - bounds.minX * scale,
    y: (frame.height - bounds.height * scale) / 2 - bounds.minY * scale,
  };
  updateCamera();
}

function fitSelection() {
  if (!state.selectedId || !state.positions.has(state.selectedId)) return;
  const frame = elements.canvasFrame.getBoundingClientRect();
  const position = state.positions.get(state.selectedId);
  const scale = Math.min(1.35, Math.max(0.72, state.camera.scale));
  state.camera = {
    scale,
    x: frame.width / 2 - (position.x + position.width / 2) * scale,
    y: frame.height / 2 - (position.y + position.height / 2) * scale,
  };
  updateCamera();
}

function zoomAt(nextScale, screenX, screenY) {
  const rect = elements.canvas.getBoundingClientRect();
  const pointX = screenX ?? rect.left + rect.width / 2;
  const pointY = screenY ?? rect.top + rect.height / 2;
  const localX = pointX - rect.left;
  const localY = pointY - rect.top;
  const graphX = (localX - state.camera.x) / state.camera.scale;
  const graphY = (localY - state.camera.y) / state.camera.scale;
  const scale = Math.max(CAMERA.min, Math.min(CAMERA.max, nextScale));
  state.camera.x = localX - graphX * scale;
  state.camera.y = localY - graphY * scale;
  state.camera.scale = scale;
  updateCamera();
}

function resetZoom() {
  zoomAt(1);
}

function renderMinimap() {
  const bounds = state.layoutBounds;
  elements.minimap.setAttribute("viewBox", `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`);
  const edgeNodes = [];
  for (const edge of state.bundle.edges) {
    if (!state.visibleIds.has(edge.source) || !state.visibleIds.has(edge.target)) continue;
    const source = state.positions.get(edge.source);
    const target = state.positions.get(edge.target);
    edgeNodes.push(svgElement("line", { class: "minimap-edge", x1: source.x + source.width / 2, y1: source.y + source.height / 2, x2: target.x + target.width / 2, y2: target.y + target.height / 2 }));
  }
  const nodeNodes = [...state.visibleIds].map((id) => {
    const node = state.nodeById.get(id);
    const position = state.positions.get(id);
    const classes = ["minimap-node"];
    if (node.flags?.isOnWinningPath) classes.push("is-winning");
    if (id === state.selectedId) classes.push("is-selected");
    return svgElement("rect", { class: classes.join(" "), x: position.x, y: position.y, width: position.width, height: position.height, rx: 18 });
  });
  replaceChildren(elements.minimapEdges, edgeNodes);
  replaceChildren(elements.minimapNodes, nodeNodes);
  updateMinimapViewport();
}

function updateMinimapViewport() {
  const frame = elements.canvasFrame.getBoundingClientRect();
  if (!frame.width || !frame.height) return;
  elements.minimapViewport.setAttribute("x", String(-state.camera.x / state.camera.scale));
  elements.minimapViewport.setAttribute("y", String(-state.camera.y / state.camera.scale));
  elements.minimapViewport.setAttribute("width", String(frame.width / state.camera.scale));
  elements.minimapViewport.setAttribute("height", String(frame.height / state.camera.scale));
}

function selectNode(id, { center = false, push = false } = {}) {
  if (id && !state.nodeById.has(id)) return;
  state.selectedId = id;
  if (state.searchMatches.length) state.searchIndex = state.searchMatches.indexOf(id);
  renderGraph();
  renderMinimap();
  renderBreadcrumbs();
  renderInspector();
  renderToolbarState();
  if (center && id) fitSelection(); else updateCamera();
  syncUrl(push);
}

function renderBreadcrumbs() {
  if (!state.selectedId) {
    elements.breadcrumbs.replaceChildren();
    return;
  }
  const path = ancestors(state.selectedId);
  const children = [];
  path.forEach((id, index) => {
    const node = state.nodeById.get(id);
    const button = document.createElement("button");
    button.type = "button";
    button.title = node.label;
    button.textContent = node.flags?.isRoot ? "Root" : node.incomingAnswer?.optionLabel || node.shortLabel;
    button.addEventListener("click", () => selectNode(id, { center: true, push: true }));
    children.push(button);
    if (index < path.length - 1) children.push(htmlElement("span", "breadcrumb-separator", "›"));
  });
  replaceChildren(elements.breadcrumbs, children);
}

function pill(label, className = "") {
  return htmlElement("span", `pill ${className}`.trim(), label);
}

function sectionBlock(label, value) {
  const block = htmlElement("div", "section-block");
  block.append(htmlElement("span", "section-label", label), htmlElement("p", "", text(value)));
  return block;
}

function metric(label, value) {
  const item = htmlElement("div", "metric");
  item.append(htmlElement("span", "metric-label", label), htmlElement("span", "metric-value", value));
  return item;
}

function listBlock(label, values) {
  if (!values?.length) return null;
  const block = htmlElement("div", "section-block");
  const list = htmlElement("ul", "item-list");
  values.forEach((value) => list.append(htmlElement("li", "", String(value))));
  block.append(htmlElement("span", "section-label", label), list);
  return block;
}

function renderInspector() {
  const node = state.selectedId ? state.nodeById.get(state.selectedId) : null;
  elements.inspector.classList.toggle("has-selection", Boolean(node));
  elements.inspectorEmpty.hidden = Boolean(node);
  elements.inspectorContent.hidden = !node;
  if (!node) {
    elements.inspectorTitle.textContent = "Select a branch";
    return;
  }
  elements.inspectorTitle.textContent = truncate(node.shortLabel || node.label, 50);
  renderInspectorSummary(node);
  renderInspectorQuestion(node);
  renderInspectorEvaluation(node);
  renderInspectorEvidence(node);
  renderInspectorProvenance(node);
}

function renderInspectorSummary(node) {
  const wrapper = htmlElement("div", "inspector-section");
  const badges = htmlElement("div", "badge-row");
  badges.append(pill(nodeKindLabel(node.kind), `type-${node.kind}`), pill(`Depth ${node.depth}`));
  if (node.flags?.isWinningLeaf) badges.append(pill("Winner", "flag-winning"));
  if (node.flags?.isOnWinningPath) badges.append(pill("Winning path", "flag-winning"));
  if (node.flags?.isLocallyRecommendedIncoming) badges.append(pill("Local choice", "flag-local"));
  if (node.flags?.isHindsightBestIncoming) badges.append(pill("Hindsight choice", "flag-hindsight"));
  wrapper.append(badges, htmlElement("p", "summary-copy", node.label));
  if (node.pathKey) wrapper.append(htmlElement("div", "path-key", node.pathKey));
  const scores = htmlElement("div", "metric-grid");
  if (node.score?.state === "scored_leaf") {
    scores.append(metric("Adjusted", percent(node.score.adjusted)), metric("Raw", percent(node.score.raw)), metric("Confidence", percent(node.score.confidence)));
  } else if (node.score?.subtree) {
    scores.append(metric("Best", percent(node.score.subtree.best)), metric("Mean", percent(node.score.subtree.mean)), metric("Worst", percent(node.score.subtree.worst)));
  } else {
    scores.append(metric("Score", "Unknown"), metric("Reason", text(node.score?.absentReason).replaceAll("_", " ")), metric("Evaluators", String(node.score?.evaluatorCount || 0)));
  }
  wrapper.append(scores);
  if (node.conclusion?.recommendation) wrapper.append(sectionBlock("Recommendation", node.conclusion.recommendation));
  const nav = htmlElement("div", "node-nav");
  const path = ancestors(node.id);
  const siblings = node.parentId ? state.childrenById.get(node.parentId) || [] : [];
  const index = siblings.indexOf(node.id);
  const navItems = [
    ["↑ Parent", node.parentId],
    ["← Previous", index > 0 ? siblings[index - 1] : null],
    ["Next →", index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null],
    ["↓ First child", (state.childrenById.get(node.id) || [])[0]],
    ["◆ Best leaf", node.score?.subtree?.bestDescendantBranchId],
  ];
  navItems.forEach(([label, target]) => {
    if (!target || target === node.id || !state.nodeById.has(target)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => revealAndSelect(target));
    nav.append(button);
  });
  if (nav.children.length) wrapper.append(nav);
  replaceChildren(elements.inspectorSummary, [wrapper]);
}

function renderInspectorQuestion(node) {
  const wrapper = htmlElement("div", "inspector-section");
  const incoming = state.edgeByTarget.get(node.id);
  if (incoming) {
    wrapper.append(sectionBlock("Selected answer", `${incoming.label} — ${incoming.description}`));
    appendChildren(wrapper, listBlock("Expected consequences", incoming.expectedConsequences), listBlock("Assumptions", incoming.assumptions), listBlock("Trade-offs", incoming.tradeoffs));
  }
  if (node.question) {
    wrapper.append(sectionBlock("Question", node.question.text), sectionBlock("Rationale", node.question.rationale));
    const local = node.question.localRecommendation;
    const hindsight = node.question.hindsight;
    wrapper.append(sectionBlock("Local recommendation", `${local.optionKey}: ${local.reason} (${percent(local.confidence)} confidence)`));
    wrapper.append(sectionBlock("Hindsight", hindsight.optionKey ? `${hindsight.optionKey}${hindsight.changedLocalRecommendation ? " — changed the local recommendation" : " — confirmed the local recommendation"}` : "Insufficient scored evidence"));
    const optionList = htmlElement("div", "option-list");
    for (const edge of state.edgesBySource.get(node.id) || []) optionList.append(renderOption(edge));
    if (optionList.children.length) {
      const block = htmlElement("div", "section-block");
      block.append(htmlElement("span", "section-label", "Candidate answers"), optionList);
      wrapper.append(block);
    }
    appendChildren(wrapper, listBlock("Resolves", node.question.resolves), sectionBlock("Coverage", node.question.coverageRationale), sectionBlock("Atomicity", node.question.atomicityRationale), sectionBlock("Exclusivity", node.question.exclusivityRationale));
  } else if (!incoming) {
    wrapper.append(sectionBlock("Question", "This branch has no question or incoming answer."));
  }
  replaceChildren(elements.inspectorQuestion, [wrapper]);
}

function renderOption(edge) {
  const button = htmlElement("button", "option-card");
  button.type = "button";
  if (edge.flags?.isLocalRecommendation) button.classList.add("is-local");
  if (edge.flags?.isHindsightChoice) button.classList.add("is-hindsight");
  if (edge.flags?.isOnWinningPath) button.classList.add("is-winning");
  const heading = htmlElement("div", "option-heading");
  heading.append(htmlElement("strong", "", `${edge.optionKey}: ${edge.label}`));
  const flags = htmlElement("span", "option-flags");
  if (edge.flags?.isLocalRecommendation) flags.append(htmlElement("span", "mini-flag flag-local", "Local"));
  if (edge.flags?.isHindsightChoice) flags.append(htmlElement("span", "mini-flag flag-hindsight", "Hindsight"));
  if (edge.flags?.isOnWinningPath) flags.append(htmlElement("span", "mini-flag flag-winning", "Winner"));
  heading.append(flags);
  button.append(heading, htmlElement("span", "summary-copy", edge.description || "No description"));
  button.addEventListener("click", () => revealAndSelect(edge.target));
  return button;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function renderInspectorEvaluation(node) {
  const wrapper = htmlElement("div", "inspector-section");
  const evaluations = node.evaluations || [];
  if (!evaluations.length) {
    wrapper.append(sectionBlock("Evaluation", `No evaluator output is available${node.score?.absentReason ? ` (${node.score.absentReason.replaceAll("_", " ")})` : ""}.`));
    replaceChildren(elements.inspectorEvaluation, [wrapper]);
    return;
  }
  const aggregate = htmlElement("div", "evaluation-card");
  aggregate.append(htmlElement("strong", "", `Criterion medians · ${evaluations.length} evaluator${evaluations.length === 1 ? "" : "s"}`));
  for (const criterion of state.bundle.criteria || []) {
    const values = evaluations.flatMap((record) => (record.evaluation?.criterionScores || []).filter((score) => score.criterionKey === criterion.key).map((score) => score.score));
    const value = median(values);
    if (value === null) continue;
    aggregate.append(scoreRow(criterion.label, value));
  }
  wrapper.append(aggregate);
  const list = htmlElement("div", "evaluation-list");
  evaluations.forEach((record) => {
    const card = htmlElement("article", "evaluation-card");
    const header = document.createElement("header");
    header.append(htmlElement("strong", "", `Evaluator ${record.evaluatorOrdinal + 1}`), htmlElement("span", "criterion-score", percent(record.evaluation?.confidence)));
    card.append(header);
    for (const score of record.evaluation?.criterionScores || []) {
      const criterion = (state.bundle.criteria || []).find((item) => item.key === score.criterionKey);
      card.append(scoreRow(criterion?.label || score.criterionKey, score.score), htmlElement("p", "summary-copy", score.rationale));
    }
    list.append(card);
  });
  wrapper.append(list);
  replaceChildren(elements.inspectorEvaluation, [wrapper]);
}

function scoreRow(label, value) {
  const row = htmlElement("div", "criterion-row");
  const bar = htmlElement("span", "score-bar");
  const fill = document.createElement("span");
  fill.style.width = `${Math.max(0, Math.min(100, value * 100))}%`;
  bar.append(fill);
  row.append(htmlElement("span", "", label), bar, htmlElement("span", "criterion-score", percent(value)));
  return row;
}

function unique(items) {
  return [...new Set(items.filter((item) => item !== null && item !== undefined && item !== ""))];
}

function renderInspectorEvidence(node) {
  const wrapper = htmlElement("div", "inspector-section");
  const evaluations = node.evaluations || [];
  const evidence = [];
  const seen = new Set();
  for (const record of evaluations) {
    for (const item of record.evaluation?.evidence || []) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) { seen.add(key); evidence.push(item); }
    }
  }
  if (evidence.length) {
    const list = htmlElement("div", "evidence-list");
    evidence.forEach((item) => {
      const card = htmlElement("article", "evidence-card");
      const header = document.createElement("header");
      header.append(htmlElement("strong", "", item.claim), pill(item.strength || "unknown"));
      card.append(header, sectionBlock("Source", item.source));
      list.append(card);
    });
    wrapper.append(list);
  }
  const incoming = state.edgeByTarget.get(node.id);
  appendChildren(wrapper,
    listBlock("Expected consequences", incoming?.expectedConsequences),
    listBlock("Assumptions", unique([...(incoming?.assumptions || []), ...evaluations.flatMap((record) => record.evaluation?.assumptions || [])])),
    listBlock("Trade-offs", incoming?.tradeoffs),
    listBlock("Conditions", node.conclusion?.conditions),
    listBlock("Caveats", unique([...(node.conclusion?.caveats || []), ...evaluations.flatMap((record) => record.evaluation?.caveats || [])])),
    listBlock("Unresolved questions", node.conclusion?.unresolvedQuestions),
  );
  if (!wrapper.children.length) wrapper.append(sectionBlock("Evidence", "No evidence, assumptions, or caveats were recorded for this branch."));
  replaceChildren(elements.inspectorEvidence, [wrapper]);
}

function renderInspectorProvenance(node) {
  const wrapper = htmlElement("div", "inspector-section");
  const incoming = state.edgeByTarget.get(node.id);
  const definition = htmlElement("dl", "definition-list");
  const values = [
    ["Branch ID", node.id],
    ["Parent ID", node.parentId],
    ["Created ordinal", node.createdOrdinal],
    ["Preorder ordinal", node.preorderOrdinal],
    ["Path key", node.pathKey],
    ["Status", node.status],
    ["Terminal reason", node.terminalReason],
    ["Question ID", node.question?.questionId || incoming?.questionId],
    ["Semantic key", node.question?.semanticKey || node.incomingAnswer?.questionSemanticKey],
    ["Expansion ID", node.question?.expansionId],
    ["Option key", incoming?.optionKey || node.incomingAnswer?.optionKey],
    ["Option ordinal", incoming?.optionOrdinal],
    ["State hash", node.branchStateHash || node.provenance?.branchStateHash],
    ["Events applied", state.bundle.generatedFrom?.eventsApplied],
    ["Last event ID", state.bundle.generatedFrom?.lastEventId],
    ["Request key", state.bundle.run.requestKey],
    ["Config key", state.bundle.run.configKey],
  ];
  for (const [label, value] of values) {
    if (value === null || value === undefined || value === "") continue;
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = String(value);
    row.append(dt, dd);
    definition.append(row);
  }
  wrapper.append(definition);
  const evaluationIds = (node.evaluations || []).map((evaluation) => `${evaluation.id} (evaluator ${evaluation.evaluatorOrdinal + 1})`);
  appendChildren(wrapper, listBlock("Evaluation IDs", evaluationIds));
  replaceChildren(elements.inspectorProvenance, [wrapper]);
}

function revealAndSelect(id) {
  if (!state.nodeById.has(id)) return;
  state.focusId = null;
  for (const ancestor of ancestors(id)) state.collapsed.delete(ancestor);
  state.selectedId = id;
  render({ preserve: false });
  fitSelection();
  syncUrl(true);
  requestAnimationFrame(() => elements.nodeLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
}

function toggleCollapse(id = state.selectedId) {
  if (!id || !(state.childrenById.get(id) || []).length) return;
  if (state.collapsed.has(id)) state.collapsed.delete(id); else state.collapsed.add(id);
  render({ preserve: true });
  syncUrl();
}

function toggleFocus() {
  if (!state.selectedId && !state.focusId) return;
  state.focusId = state.focusId ? null : state.selectedId;
  render({ preserve: false, fit: true });
  syncUrl();
  announce(state.focusId ? `Focused ${state.nodeById.get(state.focusId).label}.` : "Showing the complete decision tree.");
}

function updateSearch(reset = true) {
  state.searchQuery = elements.search.value.trim();
  const query = normalize(state.searchQuery);
  if (!query) {
    state.searchMatches = [];
    state.searchIndex = -1;
  } else {
    state.searchMatches = state.bundle.nodes
      .filter((node) => normalize(flattenText(node).join(" ")).includes(query))
      .sort((a, b) => a.preorderOrdinal - b.preorderOrdinal || a.createdOrdinal - b.createdOrdinal)
      .map((node) => node.id);
    state.searchIndex = reset ? (state.searchMatches.length ? 0 : -1) : Math.min(state.searchIndex, state.searchMatches.length - 1);
  }
  renderGraph();
  renderMinimap();
  renderToolbarState();
  if (state.searchMatches.length && reset) navigateSearch(0);
  else announce(`${state.searchMatches.length} search result${state.searchMatches.length === 1 ? "" : "s"}.`);
}

function navigateSearch(delta) {
  if (!state.searchMatches.length) return;
  state.searchIndex = (state.searchIndex + delta + state.searchMatches.length) % state.searchMatches.length;
  const id = state.searchMatches[state.searchIndex];
  revealAndSelect(id);
  elements.searchCount.textContent = `${state.searchIndex + 1} / ${state.searchMatches.length}`;
  announce(`Search result ${state.searchIndex + 1} of ${state.searchMatches.length}: ${state.nodeById.get(id).label}`);
}

function navigateRelative(direction) {
  if (!state.selectedId) {
    if (state.rootId) revealAndSelect(state.rootId);
    return;
  }
  const node = state.nodeById.get(state.selectedId);
  let target = null;
  if (direction === "parent") target = node.parentId;
  if (direction === "child") target = (state.visibleChildren.get(node.id) || [])[0];
  if (direction === "previous" || direction === "next") {
    const siblings = node.parentId ? state.visibleChildren.get(node.parentId) || [] : [];
    const index = siblings.indexOf(node.id);
    target = siblings[index + (direction === "next" ? 1 : -1)];
  }
  if (target) revealAndSelect(target);
}

function navigatePreorder(delta) {
  const visible = [...state.visibleIds].map((id) => state.nodeById.get(id)).sort((a, b) => a.preorderOrdinal - b.preorderOrdinal);
  if (!visible.length) return;
  const index = Math.max(0, visible.findIndex((node) => node.id === state.selectedId));
  const next = visible[(index + delta + visible.length) % visible.length];
  revealAndSelect(next.id);
}

function isTypingTarget(target) {
  return target instanceof HTMLElement && (target.matches("input, textarea, select") || target.isContentEditable);
}

function bindEvents() {
  elements.runSelect.addEventListener("change", () => loadRun(elements.runSelect.value, { view: state.view, orientation: state.orientation, selectedId: null, focusId: null, collapsed: new Set() }).catch(showError));
  elements.search.addEventListener("input", () => updateSearch(true));
  elements.search.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); navigateSearch(event.shiftKey ? -1 : 1); }
    if (event.key === "ArrowDown") { event.preventDefault(); navigateSearch(1); }
    if (event.key === "ArrowUp") { event.preventDefault(); navigateSearch(-1); }
    if (event.key === "Escape") { elements.search.value = ""; updateSearch(true); elements.search.blur(); }
  });
  elements.searchPrev.addEventListener("click", () => navigateSearch(-1));
  elements.searchNext.addEventListener("click", () => navigateSearch(1));
  elements.treeButton.addEventListener("click", () => { state.view = "tree"; render({ fit: true }); syncUrl(); });
  elements.radialButton.addEventListener("click", () => { state.view = "radial"; render({ fit: true }); syncUrl(); });
  elements.tbButton.addEventListener("click", () => { state.orientation = "tb"; render({ fit: true }); syncUrl(); });
  elements.lrButton.addEventListener("click", () => { state.orientation = "lr"; render({ fit: true }); syncUrl(); });
  elements.focusButton.addEventListener("click", toggleFocus);
  elements.collapseButton.addEventListener("click", () => toggleCollapse());
  elements.expandAllButton.addEventListener("click", () => { state.collapsed.clear(); render({ preserve: true }); syncUrl(); });
  elements.fitAllButton.addEventListener("click", fitAll);
  elements.fitSelectionButton.addEventListener("click", fitSelection);
  elements.zoomOutButton.addEventListener("click", () => zoomAt(state.camera.scale / 1.18));
  elements.zoomInButton.addEventListener("click", () => zoomAt(state.camera.scale * 1.18));
  elements.zoomResetButton.addEventListener("click", resetZoom);
  elements.helpButton.addEventListener("click", () => elements.help.showModal());
  elements.closeHelp.addEventListener("click", () => elements.help.close());
  elements.closeInspector.addEventListener("click", () => selectNode(null, { push: true }));
  elements.retry.addEventListener("click", () => loadRuns().catch(showError));

  elements.canvas.addEventListener("click", (event) => {
    if (event.target.classList.contains("canvas-hit-target") || event.target === elements.canvas) selectNode(null, { push: true });
  });
  elements.canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) zoomAt(state.camera.scale * Math.exp(-event.deltaY * 0.002), event.clientX, event.clientY);
    else {
      state.camera.x -= event.deltaX || (event.shiftKey ? event.deltaY : 0);
      state.camera.y -= event.shiftKey ? 0 : event.deltaY;
      updateCamera();
    }
  }, { passive: false });
  elements.canvas.addEventListener("pointerdown", (event) => {
    const background = event.target.classList.contains("canvas-hit-target") || event.target === elements.canvas;
    if (!(event.button === 1 || state.spaceDown || (event.pointerType === "touch" && background))) return;
    event.preventDefault();
    elements.canvas.setPointerCapture(event.pointerId);
    state.pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, cameraX: state.camera.x, cameraY: state.camera.y };
    elements.canvas.classList.add("is-panning");
  });
  elements.canvas.addEventListener("pointermove", (event) => {
    if (!state.pan || state.pan.pointerId !== event.pointerId) return;
    state.camera.x = state.pan.cameraX + event.clientX - state.pan.x;
    state.camera.y = state.pan.cameraY + event.clientY - state.pan.y;
    updateCamera();
  });
  const finishPan = (event) => {
    if (!state.pan || state.pan.pointerId !== event.pointerId) return;
    state.pan = null;
    elements.canvas.classList.remove("is-panning");
  };
  elements.canvas.addEventListener("pointerup", finishPan);
  elements.canvas.addEventListener("pointercancel", finishPan);

  elements.minimap.addEventListener("click", (event) => {
    const point = elements.minimap.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const graphPoint = point.matrixTransform(elements.minimap.getScreenCTM().inverse());
    const frame = elements.canvasFrame.getBoundingClientRect();
    state.camera.x = frame.width / 2 - graphPoint.x * state.camera.scale;
    state.camera.y = frame.height / 2 - graphPoint.y * state.camera.scale;
    updateCamera();
  });

  window.addEventListener("keydown", (event) => {
    if (elements.help.open) {
      if (event.key === "Escape") elements.help.close();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      elements.search.focus();
      elements.search.select();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (event.key === " ") { state.spaceDown = true; elements.canvas.classList.add("is-pannable"); event.preventDefault(); }
    if (event.key === "ArrowUp") { event.preventDefault(); navigateRelative("parent"); }
    if (event.key === "ArrowDown") { event.preventDefault(); navigateRelative("child"); }
    if (event.key === "ArrowLeft") { event.preventDefault(); navigateRelative("previous"); }
    if (event.key === "ArrowRight") { event.preventDefault(); navigateRelative("next"); }
    if (event.key.toLowerCase() === "j") navigatePreorder(1);
    if (event.key.toLowerCase() === "k") navigatePreorder(-1);
    if (event.key.toLowerCase() === "c") toggleCollapse();
    if (event.key.toLowerCase() === "f") toggleFocus();
    if (event.key === "1") fitAll();
    if (event.key === "2") fitSelection();
    if (event.key === "0") resetZoom();
    if (event.key === "+" || event.key === "=") zoomAt(state.camera.scale * 1.18);
    if (event.key === "-") zoomAt(state.camera.scale / 1.18);
    if (event.key === "?") elements.help.showModal();
    if (event.key === "Escape") {
      if (state.focusId) { state.focusId = null; render({ fit: true }); syncUrl(); }
      else selectNode(null, { push: true });
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === " ") { state.spaceDown = false; elements.canvas.classList.remove("is-pannable"); }
  });
  window.addEventListener("blur", () => { state.spaceDown = false; elements.canvas.classList.remove("is-pannable"); });
  window.addEventListener("resize", () => updateMinimapViewport());
  window.addEventListener("popstate", () => {
    const params = readUiParams();
    if (params.runId && params.runId !== state.runId) loadRun(params.runId, params).catch(showError);
    else {
      state.selectedId = state.nodeById.has(params.selectedId) ? params.selectedId : null;
      state.focusId = state.nodeById.has(params.focusId) ? params.focusId : null;
      state.view = params.view;
      state.orientation = params.orientation;
      state.collapsed = new Set([...params.collapsed].filter((id) => state.nodeById.has(id)));
      render({ fit: true });
    }
  });
}

bindEvents();
loadRuns().catch(showError);
