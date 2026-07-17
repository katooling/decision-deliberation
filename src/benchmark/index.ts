/**
 * Deterministic, closed-world proof for exhaustive path traversal and
 * post-order hindsight reduction. No model provider is invoked here.
 */

export const SYNTHETIC_BENCHMARK_DISCLAIMER =
  "These results measure declared decision fixtures and do not establish broad real-world superiority.";

const BENCHMARK_VERSION = "decision-deliberation-synthetic-v1";
const DEFAULT_SEED = 0x5eedc0de;
const DEFAULT_MATERIAL_REGRET_DELTA = 0.1;

export interface SyntheticBenchmarkOptions {
  seed?: number;
  caseCount?: number;
  depth?: number;
  minOptions?: number;
  maxOptions?: number;
  materialRegretDelta?: number;
  enforceGate?: boolean;
}

export interface SyntheticStrategyResult {
  selectedPath: string;
  selectedUtility: number;
  selectedFeasible: boolean;
  exactOptimal: boolean;
  normalizedScore: number;
  normalizedRegret: number;
  admittedPathCoverage: number;
  admittedPaths: number;
  evaluatedPaths: number;
  nodesVisited: number;
  calls: number;
}

export interface SyntheticCaseResult {
  caseId: string;
  seed: number;
  depth: number;
  questionNodes: number;
  admittedPaths: number;
  optimalPath: string;
  greedyPath: string;
  localRecommendationIsTrap: boolean;
  baseline: SyntheticStrategyResult;
  treatment: SyntheticStrategyResult;
}

export interface SyntheticAggregateMetrics {
  exactOptimalRate: number;
  normalizedRegret: number;
  admittedPathCoverage: number;
  hardConstraintViolationRate: number;
  nodesVisited: number;
  calls: number;
}

export interface BenchmarkGateCheck {
  id: string;
  passed: boolean;
  actual: number;
  requirement: string;
}

export interface SyntheticBenchmarkReport {
  benchmarkVersion: string;
  profile: "quick";
  seed: number;
  fixtureCount: number;
  configuration: {
    depth: number;
    minOptions: number;
    maxOptions: number;
    materialRegretDelta: number;
  };
  cases: SyntheticCaseResult[];
  aggregate: {
    baseline: SyntheticAggregateMetrics;
    treatment: SyntheticAggregateMetrics;
    normalizedRegretImprovement: number;
  };
  gate: {
    passed: boolean;
    checks: BenchmarkGateCheck[];
  };
  disclaimer: string;
}

interface Selection {
  questionId: string;
  optionKey: string;
  localScore: number;
}

interface SyntheticLeaf {
  kind: "leaf";
  id: string;
  path: Selection[];
  feasible: boolean;
  utility: number;
}

interface SyntheticOption {
  key: string;
  localScore: number;
  next: SyntheticNode;
}

interface SyntheticQuestion {
  kind: "question";
  id: string;
  depth: number;
  recommendedOptionKey: string;
  options: SyntheticOption[];
}

type SyntheticNode = SyntheticQuestion | SyntheticLeaf;

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  integer(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

function mixSeed(seed: number, ordinal: number): number {
  let value = (seed ^ Math.imul(ordinal + 1, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function pathKey(path: readonly Selection[]): string {
  return path.map((step) => `${step.questionId}:${step.optionKey}`).join("|");
}

function collectTree(root: SyntheticNode): {
  questions: SyntheticQuestion[];
  leaves: SyntheticLeaf[];
} {
  const questions: SyntheticQuestion[] = [];
  const leaves: SyntheticLeaf[] = [];
  const visit = (node: SyntheticNode): void => {
    if (node.kind === "leaf") {
      leaves.push(node);
      return;
    }
    questions.push(node);
    for (const option of node.options) visit(option.next);
  };
  visit(root);
  return { questions, leaves };
}

function followLocalRecommendations(root: SyntheticNode): {
  leaf: SyntheticLeaf;
  nodesVisited: number;
} {
  let node = root;
  let nodesVisited = 1;
  while (node.kind === "question") {
    const question = node;
    const option = question.options.find(
      (candidate) => candidate.key === question.recommendedOptionKey,
    );
    if (!option) throw new Error(`Missing recommended option for ${question.id}`);
    node = option.next;
    nodesVisited += 1;
  }
  return { leaf: node, nodesVisited };
}

function betterLeaf(left: SyntheticLeaf, right: SyntheticLeaf): SyntheticLeaf {
  if (left.feasible !== right.feasible) return left.feasible ? left : right;
  if (left.utility !== right.utility) return left.utility > right.utility ? left : right;
  return pathKey(left.path).localeCompare(pathKey(right.path)) <= 0 ? left : right;
}

/** Traverse every child before selecting the best descendant. */
function hindsightReduction(node: SyntheticNode): SyntheticLeaf {
  if (node.kind === "leaf") return node;
  const reduced = node.options.map((option) => hindsightReduction(option.next));
  const first = reduced[0];
  if (!first) throw new Error(`Question ${node.id} has no options`);
  return reduced.slice(1).reduce(betterLeaf, first);
}

function buildFixture(
  seed: number,
  ordinal: number,
  depthLimit: number,
  minOptions: number,
  maxOptions: number,
): { root: SyntheticQuestion; greedy: SyntheticLeaf; optimal: SyntheticLeaf } {
  const random = new SeededRandom(seed);
  let questionOrdinal = 0;
  let leafOrdinal = 0;

  const build = (depth: number, path: Selection[]): SyntheticNode => {
    if (depth === depthLimit) {
      leafOrdinal += 1;
      return {
        kind: "leaf",
        id: `leaf_${leafOrdinal}`,
        path,
        feasible: true,
        utility: 0,
      };
    }
    questionOrdinal += 1;
    const id = `q_${questionOrdinal}`;
    const optionCount = random.integer(minOptions, maxOptions);
    const scores = Array.from({ length: optionCount }, (_, index) =>
      round(0.25 + random.next() * 0.7 + index * 0.000001),
    );
    let recommendedIndex = 0;
    for (let index = 1; index < scores.length; index += 1) {
      if ((scores[index] ?? 0) > (scores[recommendedIndex] ?? 0)) recommendedIndex = index;
    }
    const options: SyntheticOption[] = scores.map((localScore, index) => {
      const key = `choice_${index + 1}`;
      const nextPath = [...path, { questionId: id, optionKey: key, localScore }];
      return { key, localScore, next: build(depth + 1, nextPath) };
    });
    return {
      kind: "question",
      id,
      depth,
      recommendedOptionKey: `choice_${recommendedIndex + 1}`,
      options,
    };
  };

  const root = build(0, []);
  if (root.kind !== "question") throw new Error("Fixture root must be a question");
  const all = collectTree(root);
  const greedy = followLocalRecommendations(root).leaf;
  const greedyFirst = greedy.path[0]?.optionKey;
  const targetCandidates = all.leaves.filter(
    (leaf) => leaf.path[0]?.optionKey !== greedyFirst,
  );
  const target = targetCandidates[random.integer(0, targetCandidates.length - 1)];
  if (!target) throw new Error("Fixture requires a non-greedy target leaf");

  for (const leaf of all.leaves) {
    const key = pathKey(leaf.path);
    const averageLocal =
      leaf.path.reduce((sum, step) => sum + step.localScore, 0) / leaf.path.length;
    const interaction = (hash32(`${seed}:${key}`) % 1_001) / 1_000;
    leaf.feasible = hash32(`constraint:${seed}:${key}`) % 7 !== 0;
    leaf.utility = round(Math.min(0.69, 0.05 + 0.35 * averageLocal + 0.25 * interaction));
  }

  target.feasible = true;
  target.utility = 1;
  greedy.feasible = ordinal % 4 !== 0;
  if (greedy.feasible) greedy.utility = Math.min(greedy.utility, 0.35);
  const anchor = all.leaves.find((leaf) => leaf !== target && leaf !== greedy);
  if (!anchor) throw new Error("Fixture requires at least three leaves");
  anchor.feasible = true;
  anchor.utility = 0.05;

  const optimal = hindsightReduction(root);
  if (optimal !== target) throw new Error("Generated fixture lost its unique optimum");
  return { root, greedy, optimal };
}

function scoreLeaf(leaf: SyntheticLeaf, leaves: readonly SyntheticLeaf[]): number {
  if (!leaf.feasible) return 0;
  const feasibleUtilities = leaves.filter((item) => item.feasible).map((item) => item.utility);
  const minimum = Math.min(...feasibleUtilities);
  const maximum = Math.max(...feasibleUtilities);
  if (maximum === minimum) throw new Error("Fixture has no utility range");
  return Math.max(0, Math.min(1, (leaf.utility - minimum) / (maximum - minimum)));
}

function strategyResult(
  leaf: SyntheticLeaf,
  optimal: SyntheticLeaf,
  leaves: readonly SyntheticLeaf[],
  evaluatedPaths: number,
  nodesVisited: number,
  calls: number,
): SyntheticStrategyResult {
  const normalizedScore = scoreLeaf(leaf, leaves);
  return {
    selectedPath: pathKey(leaf.path),
    selectedUtility: leaf.utility,
    selectedFeasible: leaf.feasible,
    exactOptimal: pathKey(leaf.path) === pathKey(optimal.path),
    normalizedScore: round(normalizedScore),
    normalizedRegret: round(1 - normalizedScore),
    admittedPathCoverage: round(evaluatedPaths / leaves.length),
    admittedPaths: leaves.length,
    evaluatedPaths,
    nodesVisited,
    calls,
  };
}

function aggregate(
  cases: readonly SyntheticCaseResult[],
  arm: "baseline" | "treatment",
): SyntheticAggregateMetrics {
  const results = cases.map((item) => item[arm]);
  const totalAdmitted = results.reduce((sum, result) => sum + result.admittedPaths, 0);
  return {
    exactOptimalRate: round(results.filter((result) => result.exactOptimal).length / results.length),
    normalizedRegret: round(
      results.reduce((sum, result) => sum + result.normalizedRegret, 0) / results.length,
    ),
    admittedPathCoverage: round(
      results.reduce((sum, result) => sum + result.evaluatedPaths, 0) / totalAdmitted,
    ),
    hardConstraintViolationRate: round(
      results.filter((result) => !result.selectedFeasible).length / results.length,
    ),
    nodesVisited: results.reduce((sum, result) => sum + result.nodesVisited, 0),
    calls: results.reduce((sum, result) => sum + result.calls, 0),
  };
}

function requireInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
}

export function runSyntheticBenchmark(
  options: SyntheticBenchmarkOptions = {},
): SyntheticBenchmarkReport {
  const seed = options.seed ?? DEFAULT_SEED;
  const caseCount = options.caseCount ?? 4;
  const depth = options.depth ?? 3;
  const minOptions = options.minOptions ?? 2;
  const maxOptions = options.maxOptions ?? 3;
  const materialRegretDelta =
    options.materialRegretDelta ?? DEFAULT_MATERIAL_REGRET_DELTA;
  requireInteger("seed", seed, 0, 0xffff_ffff);
  requireInteger("caseCount", caseCount, 1, 100);
  requireInteger("depth", depth, 2, 6);
  requireInteger("minOptions", minOptions, 2, 4);
  requireInteger("maxOptions", maxOptions, minOptions, 4);
  if (!(materialRegretDelta > 0 && materialRegretDelta <= 1)) {
    throw new RangeError("materialRegretDelta must be greater than 0 and at most 1");
  }

  const cases: SyntheticCaseResult[] = [];
  for (let ordinal = 0; ordinal < caseCount; ordinal += 1) {
    const caseSeed = mixSeed(seed, ordinal);
    const fixture = buildFixture(caseSeed, ordinal, depth, minOptions, maxOptions);
    const tree = collectTree(fixture.root);
    const greedyRun = followLocalRecommendations(fixture.root);
    const treatmentLeaf = hindsightReduction(fixture.root);
    const baseline = strategyResult(
      greedyRun.leaf,
      fixture.optimal,
      tree.leaves,
      1,
      greedyRun.nodesVisited,
      1,
    );
    const treatment = strategyResult(
      treatmentLeaf,
      fixture.optimal,
      tree.leaves,
      tree.leaves.length,
      tree.questions.length + tree.leaves.length,
      tree.questions.length + tree.leaves.length,
    );
    cases.push({
      caseId: `synthetic_${String(ordinal + 1).padStart(2, "0")}`,
      seed: caseSeed,
      depth,
      questionNodes: tree.questions.length,
      admittedPaths: tree.leaves.length,
      optimalPath: pathKey(fixture.optimal.path),
      greedyPath: pathKey(fixture.greedy.path),
      localRecommendationIsTrap: pathKey(fixture.greedy.path) !== pathKey(fixture.optimal.path),
      baseline,
      treatment,
    });
  }

  const baselineAggregate = aggregate(cases, "baseline");
  const treatmentAggregate = aggregate(cases, "treatment");
  const normalizedRegretImprovement = round(
    baselineAggregate.normalizedRegret - treatmentAggregate.normalizedRegret,
  );
  const checks: BenchmarkGateCheck[] = [
    {
      id: "treatment_path_coverage",
      passed: treatmentAggregate.admittedPathCoverage === 1,
      actual: treatmentAggregate.admittedPathCoverage,
      requirement: "= 1.0",
    },
    {
      id: "treatment_exact_optimal_rate",
      passed: treatmentAggregate.exactOptimalRate === 1,
      actual: treatmentAggregate.exactOptimalRate,
      requirement: "= 1.0",
    },
    {
      id: "material_regret_improvement",
      passed: normalizedRegretImprovement >= materialRegretDelta,
      actual: normalizedRegretImprovement,
      requirement: `>= ${materialRegretDelta}`,
    },
  ];

  const report: SyntheticBenchmarkReport = {
    benchmarkVersion: BENCHMARK_VERSION,
    profile: "quick",
    seed,
    fixtureCount: cases.length,
    configuration: { depth, minOptions, maxOptions, materialRegretDelta },
    cases,
    aggregate: {
      baseline: baselineAggregate,
      treatment: treatmentAggregate,
      normalizedRegretImprovement,
    },
    gate: { passed: checks.every((check) => check.passed), checks },
    disclaimer: SYNTHETIC_BENCHMARK_DISCLAIMER,
  };
  if (options.enforceGate !== false) assertSyntheticBenchmarkGate(report);
  return report;
}

export function assertSyntheticBenchmarkGate(report: SyntheticBenchmarkReport): void {
  const failures = report.gate.checks.filter((check) => !check.passed);
  if (failures.length > 0) {
    throw new Error(
      `Synthetic benchmark gate failed: ${failures.map((failure) => failure.id).join(", ")}`,
    );
  }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function renderBenchmarkMarkdown(report: SyntheticBenchmarkReport): string {
  const lines = [
    "# Deterministic Synthetic Benchmark",
    "",
    `Benchmark: \`${report.benchmarkVersion}\`  `,
    `Profile: \`${report.profile}\`  `,
    `Seed: \`${report.seed}\`  `,
    `Fixtures: \`${report.fixtureCount}\``,
    "",
    "This suite invokes no model. It proves closed-world traversal and hindsight-reduction behavior; call counts model proposer and leaf-evaluator work.",
    "",
    "| Arm | Exact optimal | Normalized regret | Path coverage | Constraint violations | Nodes | Calls |",
    "|---|---:|---:|---:|---:|---:|---:|",
    `| Greedy local baseline | ${percent(report.aggregate.baseline.exactOptimalRate)} | ${report.aggregate.baseline.normalizedRegret.toFixed(3)} | ${percent(report.aggregate.baseline.admittedPathCoverage)} | ${percent(report.aggregate.baseline.hardConstraintViolationRate)} | ${report.aggregate.baseline.nodesVisited} | ${report.aggregate.baseline.calls} |`,
    `| Exhaustive hindsight | ${percent(report.aggregate.treatment.exactOptimalRate)} | ${report.aggregate.treatment.normalizedRegret.toFixed(3)} | ${percent(report.aggregate.treatment.admittedPathCoverage)} | ${percent(report.aggregate.treatment.hardConstraintViolationRate)} | ${report.aggregate.treatment.nodesVisited} | ${report.aggregate.treatment.calls} |`,
    "",
    `Normalized-regret improvement: **${report.aggregate.normalizedRegretImprovement.toFixed(3)}**`,
    "",
    "## Gate",
    "",
    ...report.gate.checks.map(
      (check) => `- ${check.passed ? "PASS" : "FAIL"} \`${check.id}\`: ${check.actual} (${check.requirement})`,
    ),
    "",
    "## Cases",
    "",
    "| Case | Paths | Baseline regret | Treatment regret | Treatment coverage |",
    "|---|---:|---:|---:|---:|",
    ...report.cases.map(
      (item) => `| ${item.caseId} | ${item.admittedPaths} | ${item.baseline.normalizedRegret.toFixed(3)} | ${item.treatment.normalizedRegret.toFixed(3)} | ${percent(item.treatment.admittedPathCoverage)} |`,
    ),
    "",
    `> ${report.disclaimer}`,
  ];
  return `${lines.join("\n")}\n`;
}
