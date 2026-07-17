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

const questionResolution = (path) => {
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
if (request.role === "question-proposer") {
  const currentPath = request.input.branch.branch.path
    .map((step) => step.optionKey)
    .join("");
  if (failPath && currentPath === failPath) {
    process.stdout.write(JSON.stringify({ text: "malformed fixture output" }));
    process.exit(0);
  }
  payload = {
    schemaVersion: 1,
    resolution: questionResolution(request.input.branch.branch.path)
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
  const labels = path.map((step) => step.optionLabel.replace("Option ", ""));
  const pair = labels.join("");
  const quality = pair === "CF" ? 1 : ({ AD: 0.55, AE: 0.58, AF: 0.6, BD: 0.62, BE: 0.68, BF: 0.72, CD: 0.7, CE: 0.82 }[pair] ?? 0.5);
  const resilience = pair === "CF" ? 0.95 : Math.min(0.9, quality + 0.05);
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
      { criterionKey: "resilience", score: resilience, rationale: `Fixture resilience for ${pair}.` }
    ],
    confidence: 0.95,
    evidence: [
      { claim: `${pair} has the recorded fixture outcome.`, source: "demo fixture", strength: "strong" }
    ],
    assumptions: ["The demo utility table is authoritative."],
    caveats: []
  };
} else {
  throw new Error(`Unsupported role: ${request.role}`);
}

process.stdout.write(JSON.stringify({ text: JSON.stringify(payload) }));
