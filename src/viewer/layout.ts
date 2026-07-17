import type {
  DecisionViewerBundle,
  Point,
  PositionedViewerEdge,
  PositionedViewerGraph,
  PositionedViewerNode,
  PositionedViewerRelation,
  ViewerAnswerEdge,
  ViewerNode,
} from "./types.js";

export const TREE_LAYOUT_V1 = {
  cardWidth: 240,
  cardHeight: 104,
  siblingGap: 48,
  levelGap: 104,
  margin: 80,
} as const;

export const RADIAL_LAYOUT_V1 = {
  radiusStep: 220,
  nodeWidth: 136,
  nodeHeight: 44,
  startAngle: -Math.PI / 2,
} as const;

export interface HierarchicalLayoutOptions {
  focusId?: string;
  collapsedIds?: ReadonlySet<string>;
  orientation?: "tb" | "lr";
  preset?: Partial<typeof TREE_LAYOUT_V1>;
}

export interface RadialLayoutOptions {
  focusId?: string;
  collapsedIds?: ReadonlySet<string>;
  preset?: Partial<typeof RADIAL_LAYOUT_V1>;
}

interface VisibleTopology {
  orderedNodes: ViewerNode[];
  orderedEdges: ViewerAnswerEdge[];
  children: Map<string, ViewerAnswerEdge[]>;
  relativeDepth: Map<string, number>;
  hiddenDescendantCounts: Record<string, number>;
}

function graphRoot(bundle: DecisionViewerBundle): ViewerNode {
  const root = bundle.nodes.find((node) => node.flags.isRoot);
  if (!root) throw new Error("Viewer bundle has no root node");
  return root;
}

function topology(
  bundle: DecisionViewerBundle,
  focusId: string | undefined,
  collapsedIds: ReadonlySet<string> | undefined,
): VisibleTopology {
  const nodeById = new Map(bundle.nodes.map((node) => [node.id, node]));
  const root = focusId ? nodeById.get(focusId) : graphRoot(bundle);
  if (!root) throw new Error(`Unknown layout focus ${focusId ?? ""}`);
  const allChildren = new Map<string, ViewerAnswerEdge[]>();
  for (const edge of bundle.edges) {
    allChildren.set(edge.source, [...(allChildren.get(edge.source) ?? []), edge]);
  }
  for (const children of allChildren.values()) {
    children.sort(
      (left, right) =>
        left.optionOrdinal - right.optionOrdinal || left.id.localeCompare(right.id),
    );
  }

  const collapsed = collapsedIds ?? new Set<string>();
  const orderedNodes: ViewerNode[] = [];
  const orderedEdges: ViewerAnswerEdge[] = [];
  const children = new Map<string, ViewerAnswerEdge[]>();
  const relativeDepth = new Map<string, number>();
  const stack: Array<{ id: string; depth: number; incoming?: ViewerAnswerEdge }> = [
    { id: root.id, depth: 0 },
  ];
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    const node = nodeById.get(item.id);
    if (!node) throw new Error(`Layout edge references unknown node ${item.id}`);
    orderedNodes.push(node);
    relativeDepth.set(node.id, item.depth);
    if (item.incoming) orderedEdges.push(item.incoming);
    const visibleChildren = collapsed.has(node.id)
      ? []
      : [...(allChildren.get(node.id) ?? [])];
    children.set(node.id, visibleChildren);
    for (let index = visibleChildren.length - 1; index >= 0; index -= 1) {
      const edge = visibleChildren[index];
      if (edge) stack.push({ id: edge.target, depth: item.depth + 1, incoming: edge });
    }
  }

  const hiddenDescendantCounts: Record<string, number> = {};
  for (const node of orderedNodes) {
    if (!collapsed.has(node.id)) continue;
    let count = 0;
    const descendants = [...(allChildren.get(node.id) ?? []).map((edge) => edge.target)];
    while (descendants.length > 0) {
      const id = descendants.pop();
      if (!id) continue;
      count += 1;
      descendants.push(...(allChildren.get(id) ?? []).map((edge) => edge.target));
    }
    if (count > 0) hiddenDescendantCounts[node.id] = count;
  }
  return { orderedNodes, orderedEdges, children, relativeDepth, hiddenDescendantCounts };
}

function leafIntervals(topologyInput: VisibleTopology): {
  intervals: Map<string, { first: number; last: number }>;
  leafCount: number;
} {
  const intervals = new Map<string, { first: number; last: number }>();
  let nextLeaf = 0;
  for (const node of [...topologyInput.orderedNodes].reverse()) {
    const children = topologyInput.children.get(node.id) ?? [];
    if (children.length === 0) {
      intervals.set(node.id, { first: nextLeaf, last: nextLeaf });
      nextLeaf += 1;
      continue;
    }
    const firstChild = children[0];
    const lastChild = children.at(-1);
    const first = firstChild ? intervals.get(firstChild.target) : undefined;
    const last = lastChild ? intervals.get(lastChild.target) : undefined;
    if (!first || !last) throw new Error(`Incomplete layout interval for ${node.id}`);
    intervals.set(node.id, { first: first.first, last: last.last });
  }
  return { intervals, leafCount: Math.max(1, nextLeaf) };
}

function relationPositions(
  bundle: DecisionViewerBundle,
  positions: ReadonlyMap<string, Point>,
): PositionedViewerRelation[] {
  return bundle.relations.flatMap((relation) => {
    const source = positions.get(relation.source);
    const target = positions.get(relation.target);
    if (!source || !target) return [];
    return [{ id: relation.id, source: relation.source, target: relation.target, points: [source, target] }];
  });
}

function bounds(nodes: readonly PositionedViewerNode[]): PositionedViewerGraph["bounds"] {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  const minX = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const minY = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width / 2));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height / 2));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function layoutHierarchical(
  bundle: DecisionViewerBundle,
  options: HierarchicalLayoutOptions = {},
): PositionedViewerGraph {
  const preset = { ...TREE_LAYOUT_V1, ...options.preset };
  const orientation = options.orientation ?? "tb";
  const visible = topology(bundle, options.focusId, options.collapsedIds);
  const { intervals } = leafIntervals(visible);
  const positions = new Map<string, Point>();
  const nodes: PositionedViewerNode[] = visible.orderedNodes.map((node) => {
    const interval = intervals.get(node.id);
    const depth = visible.relativeDepth.get(node.id);
    if (!interval || depth === undefined) throw new Error(`Missing layout state for ${node.id}`);
    const slot = (interval.first + interval.last) / 2;
    const point = orientation === "tb"
      ? {
          x: preset.margin + preset.cardWidth / 2 + slot * (preset.cardWidth + preset.siblingGap),
          y: preset.margin + preset.cardHeight / 2 + depth * (preset.cardHeight + preset.levelGap),
        }
      : {
          x: preset.margin + preset.cardWidth / 2 + depth * (preset.cardWidth + preset.levelGap),
          y: preset.margin + preset.cardHeight / 2 + slot * (preset.cardHeight + preset.siblingGap),
        };
    positions.set(node.id, point);
    return { id: node.id, ...point, width: preset.cardWidth, height: preset.cardHeight, relativeDepth: depth };
  });
  const edges: PositionedViewerEdge[] = visible.orderedEdges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) throw new Error(`Missing endpoint for ${edge.id}`);
    const points = orientation === "tb"
      ? [
          { x: source.x, y: source.y + preset.cardHeight / 2 },
          { x: source.x, y: (source.y + target.y) / 2 },
          { x: target.x, y: (source.y + target.y) / 2 },
          { x: target.x, y: target.y - preset.cardHeight / 2 },
        ]
      : [
          { x: source.x + preset.cardWidth / 2, y: source.y },
          { x: (source.x + target.x) / 2, y: source.y },
          { x: (source.x + target.x) / 2, y: target.y },
          { x: target.x - preset.cardWidth / 2, y: target.y },
        ];
    return { id: edge.id, source: edge.source, target: edge.target, points };
  });
  return {
    nodes,
    edges,
    relations: relationPositions(bundle, positions),
    hiddenDescendantCounts: visible.hiddenDescendantCounts,
    bounds: bounds(nodes),
  };
}

function cleanNumber(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

export function layoutRadial(
  bundle: DecisionViewerBundle,
  options: RadialLayoutOptions = {},
): PositionedViewerGraph {
  const preset = { ...RADIAL_LAYOUT_V1, ...options.preset };
  const visible = topology(bundle, options.focusId, options.collapsedIds);
  const { intervals, leafCount } = leafIntervals(visible);
  const positions = new Map<string, Point>();
  const angles = new Map<string, number>();
  const radii = new Map<string, number>();
  const nodes: PositionedViewerNode[] = visible.orderedNodes.map((node) => {
    const interval = intervals.get(node.id);
    const depth = visible.relativeDepth.get(node.id);
    if (!interval || depth === undefined) throw new Error(`Missing radial state for ${node.id}`);
    const angle = leafCount === 1
      ? preset.startAngle
      : preset.startAngle + 2 * Math.PI * ((interval.first + interval.last + 1) / (2 * leafCount));
    const radius = depth * preset.radiusStep;
    const point = depth === 0
      ? { x: 0, y: 0 }
      : { x: cleanNumber(radius * Math.cos(angle)), y: cleanNumber(radius * Math.sin(angle)) };
    positions.set(node.id, point);
    angles.set(node.id, angle);
    radii.set(node.id, radius);
    return { id: node.id, ...point, width: preset.nodeWidth, height: preset.nodeHeight, relativeDepth: depth };
  });
  const edges: PositionedViewerEdge[] = visible.orderedEdges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    const sourceAngle = angles.get(edge.source);
    const targetAngle = angles.get(edge.target);
    const sourceRadius = radii.get(edge.source);
    const targetRadius = radii.get(edge.target);
    if (!source || !target || sourceAngle === undefined || targetAngle === undefined || sourceRadius === undefined || targetRadius === undefined) {
      throw new Error(`Missing radial endpoint for ${edge.id}`);
    }
    const middleRadius = (sourceRadius + targetRadius) / 2;
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      points: [
        source,
        { x: cleanNumber(middleRadius * Math.cos(sourceAngle)), y: cleanNumber(middleRadius * Math.sin(sourceAngle)) },
        { x: cleanNumber(middleRadius * Math.cos(targetAngle)), y: cleanNumber(middleRadius * Math.sin(targetAngle)) },
        target,
      ],
    };
  });
  return {
    nodes,
    edges,
    relations: relationPositions(bundle, positions),
    hiddenDescendantCounts: visible.hiddenDescendantCounts,
    bounds: bounds(nodes),
  };
}
