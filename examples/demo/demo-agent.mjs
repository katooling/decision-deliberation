let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const failPath = process.argv
  .find((argument) => argument.startsWith("--fail-path="))
  ?.slice("--fail-path=".length);

const options = (keys) => keys.map((key) => ({
  key: key.toLowerCase(),
  label: `Option ${key}`,
  description: `Commit to option ${key}.`,
  expectedConsequences: [`The path now includes ${key}.`],
  assumptions: [`Option ${key} remains feasible.`],
  tradeoffs: [`Option ${key} excludes its siblings.`],
}));

const productOptions = [
  {
    key: "api_pilot",
    label: "API pilot first",
    description: "Recruit design partners around a narrow API before building the full interface.",
    expectedConsequences: ["Demand risk is tested before dashboard investment."],
    assumptions: ["Design partners can integrate a narrow API."],
    tradeoffs: ["The visual workflow is validated later."]
  },
  {
    key: "dashboard_first",
    label: "Dashboard prototype first",
    description: "Demonstrate the complete visual workflow before exposing an API.",
    expectedConsequences: ["Usability feedback arrives before integration feedback."],
    assumptions: ["A visual prototype is credible enough to test demand."],
    tradeoffs: ["More interface work happens before demand is proven."]
  },
  {
    key: "parallel_spikes",
    label: "Parallel API and dashboard spikes",
    description: "Split the team across two thin prototypes and compare the signals.",
    expectedConsequences: ["Both surfaces generate early evidence."],
    assumptions: ["Four engineers can sustain two coherent experiments."],
    tradeoffs: ["Focus and execution depth are reduced."]
  }
];

const productConclusions = {
  api_pilot: {
    summary: "A narrow API pilot tests willingness to integrate and pay before the team funds the full interface.",
    recommendation: "Launch a narrow API pilot with two design partners, then build the dashboard from observed workflows.",
    conditions: ["Two representative design partners commit engineering time to the pilot."],
    caveats: ["Dashboard usability remains untested until the second stage."],
    unresolvedQuestions: ["Which authentication flow minimizes partner onboarding time?"]
  },
  dashboard_first: {
    summary: "A dashboard prototype makes the product legible quickly but tests presentation before integration demand.",
    recommendation: "Prototype the dashboard first and validate the full visual workflow.",
    conditions: ["Prospects can judge demand from a non-production visual workflow."],
    caveats: ["The team may over-invest before proving integration intent."],
    unresolvedQuestions: ["Will prospects commit without an integration path?"]
  },
  parallel_spikes: {
    summary: "Parallel spikes broaden early evidence but divide a small team across two incomplete stories.",
    recommendation: "Run two time-boxed spikes and select the stronger signal after two weeks.",
    conditions: ["Each two-person group can produce a credible experiment."],
    caveats: ["Neither experiment receives the full team's attention."],
    unresolvedQuestions: ["How will conflicting signals be adjudicated?"]
  }
};

const questionResolution = (path, productMode = false) => {
  if (productMode && path.length === 0) {
    return {
      type: "expand",
      question: {
        semanticKey: "first_product_surface",
        text: "Which launch sequence should the team commit to?",
        rationale: "The first surface determines which risk is tested before the six-week deadline.",
        resolves: ["launch sequence", "first validated risk"],
        options: productOptions,
        recommendation: {
          optionKey: "dashboard_first",
          reason: "The dashboard appears easiest for prospects to understand before downstream evidence is compared.",
          confidence: 0.66
        },
        coverageRationale: "The options cover one surface first or two deliberately thin parallel experiments.",
        atomicityRationale: "Each option selects one launch sequence.",
        exclusivityRationale: "The four-person team can commit to only one sequence for this six-week window."
      }
    };
  }
  if (productMode && path.length === 1) {
    return { type: "conclude", conclusion: productConclusions[path[0].optionKey] };
  }
  if (path.length === 0) {
    return {
      type: "expand",
      question: {
        semanticKey: "primary_strategy",
        text: "Which primary strategy should we follow?",
        rationale: "The primary strategy determines the follow-up context.",
        resolves: ["primary strategy"],
        options: options(["A", "B", "C"]),
        recommendation: {
          optionKey: "a",
          reason: "A looks strongest before its downstream consequences are known.",
          confidence: 0.7
        },
        coverageRationale: "A, B, and C are the complete scoped primary strategies.",
        atomicityRationale: "Each option makes one primary commitment.",
        exclusivityRationale: "Only one primary strategy may be selected."
      }
    };
  }
  if (path.length === 1) {
    return {
      type: "expand",
      question: {
        semanticKey: "follow_up_mode",
        text: `Which follow-up mode should strategy ${path[0].optionLabel} use?`,
        rationale: "The follow-up determines the complete outcome.",
        resolves: ["follow-up mode"],
        options: options(["D", "E", "F"]),
        recommendation: {
          optionKey: "d",
          reason: "D looks safest locally.",
          confidence: 0.65
        },
        coverageRationale: "D, E, and F are the complete scoped follow-up modes.",
        atomicityRationale: "Each option selects one follow-up mode.",
        exclusivityRationale: "Only one follow-up mode may be selected."
      }
    };
  }
  const labels = path.map((step) => step.optionLabel.replace("Option ", "")).join("");
  return {
    type: "conclude",
    conclusion: {
      summary: `Path ${labels} is fully specified.`,
      recommendation: `Adopt path ${labels}.`,
      conditions: ["The scoped assumptions remain true."],
      caveats: [],
      unresolvedQuestions: []
    }
  };
};

let payload;
if (request.role === "decision-interviewer") {
  const hasAnswer = request.input.answers.length > 0;
  payload = {
    schemaVersion: 1,
    reflection: hasAnswer
      ? "The outcome and constraint are now specific enough to compare complete paths."
      : "The decision is clear, but the outcome that should govern it is still implicit.",
    ready: hasAnswer,
    question: hasAnswer ? null : "What result six months from now would make this decision clearly successful?",
    rationale: hasAnswer ? null : "The answer determines which downstream outcomes should win."
  };
} else if (request.role === "decision-framer") {
  const interview = request.input.answers
    .map((answer) => `${answer.question} ${answer.answer}`)
    .join("\n");
  payload = {
    schemaVersion: 1,
    title: "Choose the product strategy",
    decisionStatement: request.input.decision,
    context: [request.input.context, interview].filter(Boolean).join("\n\n"),
    scope: {
      inScope: ["The complete A, B, and C strategy paths"],
      outOfScope: ["Automatic execution", "Changing the declared goal"],
      constraints: ["Use the supplied success condition consistently"]
    },
    criteria: [
      {
        key: "quality",
        label: "Outcome quality",
        description: "How strongly the complete path achieves the declared result.",
        weight: 0.65,
        zeroAnchor: "The result is not achieved",
        oneAnchor: "The result is achieved exceptionally well"
      },
      {
        key: "resilience",
        label: "Resilience",
        description: "How well the path remains useful when assumptions change.",
        weight: 0.35,
        zeroAnchor: "The path fails under minor change",
        oneAnchor: "The path remains strong under material change"
      }
    ]
  };
} else if (request.role === "question-proposer") {
  const productMode = request.input.branch.decision.title === "Choose the product strategy";
  const currentPath = request.input.branch.branch.path
    .map((step) => step.optionKey)
    .join("");
  if (failPath && currentPath === failPath) {
    process.stdout.write(JSON.stringify({ text: "malformed fixture output" }));
    process.exit(0);
  }
  payload = {
    schemaVersion: 1,
    resolution: questionResolution(request.input.branch.branch.path, productMode)
  };
} else if (request.role === "coverage-reviewer") {
  payload = {
    schemaVersion: 1,
    findings: {
      missingAngles: [],
      overlaps: [],
      atomicityIssues: [],
      exclusivityIssues: [],
      pathContextRisks: []
    },
    synthesisInstructions: ["Use the complete first proposal."],
    preferredProposalIndexes: [0]
  };
} else if (request.role === "question-synthesizer") {
  payload = {
    schemaVersion: 1,
    resolution: request.input.proposals[0].resolution
  };
} else if (request.role === "branch-evaluator") {
  const path = request.input.branch.path;
  const productMode = request.input.decision.title === "Choose the product strategy";
  const labels = path.map((step) => step.optionLabel.replace("Option ", ""));
  const pair = labels.join("");
  const productKey = path[0]?.optionKey;
  const productScores = {
    api_pilot: [0.92, 0.84],
    dashboard_first: [0.69, 0.75],
    parallel_spikes: [0.76, 0.54]
  };
  const [quality, resilience] = productMode
    ? (productScores[productKey] ?? [0.5, 0.5])
    : [
        pair === "CF" ? 1 : ({ AD: 0.55, AE: 0.58, AF: 0.6, BD: 0.62, BE: 0.68, BF: 0.72, CD: 0.7, CE: 0.82 }[pair] ?? 0.5),
        pair === "CF" ? 0.95 : undefined
      ];
  const resolvedResilience = resilience ?? Math.min(0.9, quality + 0.05);
  payload = {
    schemaVersion: 1,
    conclusion: request.input.branch.conclusion ?? {
      summary: `Path ${pair || "root"} reached a configured boundary.`,
      recommendation: `Retain path ${pair || "root"} as partial evidence.`,
      conditions: ["Further exploration remains required."],
      caveats: ["This branch stopped at a configured boundary."],
      unresolvedQuestions: ["What would the next decision level reveal?"]
    },
    criterionScores: [
      { criterionKey: "quality", score: quality, rationale: `Fixture quality for ${pair}.` },
      { criterionKey: "resilience", score: resolvedResilience, rationale: `Fixture resilience for ${pair || productKey}.` }
    ],
    confidence: 0.95,
    evidence: [
      { claim: `${pair || productKey} has the recorded fixture outcome.`, source: "demo fixture", strength: "strong" }
    ],
    assumptions: ["The demo utility table is authoritative."],
    caveats: []
  };
} else {
  throw new Error(`Unsupported role: ${request.role}`);
}

process.stdout.write(JSON.stringify({ text: JSON.stringify(payload) }));
