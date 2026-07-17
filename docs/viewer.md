# Decision Tree Viewer

## Purpose

The viewer makes the saved decision evidence navigable without changing it. It must show where a branch came from, what question and answer created it, what downstream outcomes it reached, and where hindsight disagreed with the question-time recommendation.

## Design sources

- diagrams.net contributes infinite-canvas navigation, fit/zoom controls, outline/minimap thinking, folding, and stable layout choices.
- Excalidraw contributes familiar hand panning, visible zoom, search that reveals off-screen matches, and a dockable inspector.
- Obsidian contributes global versus local graph lenses, connection highlighting, search filters, groups, and depth-limited neighborhood exploration.
- Understand Anything contributes the closest application pattern: deterministic JSON input, selectable graph nodes, search-to-focus, breadcrumbs/history, minimap, detail inspector, and separate structural/focused views.

## Canonical mapping

- One visual node represents one canonical `BranchNode`.
- One directed edge represents one deterministically materialized Candidate Answer.
- The answer label belongs on the edge; the destination node represents the resulting path-sensitive branch state.
- Similar question text never merges branches. Optional semantic-peer relations are a visual overlay only.
- Missing scores display as unknown, never zero.

## Views

### Decision tree

The default causal view uses an ordered, deterministic hierarchy. It supports top-down and left-to-right orientation. Sibling order follows option ordinal, and reopening the same run yields the same positions.

### Radial overview

The graph lens uses a deterministic radial layout rather than a random force simulation. It preserves depth, answer order, and winning ancestry while making the whole run easier to scan. Semantic-peer relations remain optional and do not affect layout.

### Focus branch

The local lens shows the selected branch, its full ancestry, immediate children, and terminal siblings for comparison. It provides Obsidian-style local exploration without hiding the causal path.

## Required interactions

- pan, zoom, reset, fit-all, and fit-selection;
- minimap and visible zoom percentage;
- node selection, root-to-node path highlighting, and canonical breadcrumbs;
- search with next/previous cycling and automatic ancestor expansion;
- subtree collapse/expand and focus mode;
- deep links using run, node, and view URL state;
- keyboard navigation and shortcuts that do not fire while typing;
- a persistent inspector for summary, question, evaluation, evidence, and provenance; and
- run switching across complete, budget-limited, and failed examples.

## Visual evidence

- The global winning path receives the strongest continuous accent.
- A question-time recommendation uses a separate dashed marker.
- A hindsight-best child uses a filled marker.
- A disagreement is labelled explicitly; color alone never carries this distinction.
- Partial, boundary, open, failed, terminal, and unscored states remain visible and labelled.
- Internal nodes show best, mean, worst, and descendant count so one exceptional leaf cannot hide a fragile subtree.

## Access and safety

The local server is read-only, binds to `127.0.0.1`, validates run IDs, and serves only viewer assets plus derived graph bundles from the selected runs directory. It never serves agent secrets or mutates `graph.json`, `dossier.json`, or events.

## Deferred

Canvas editing, freehand drawing, node dragging, comments, collaboration, semantic search, semantic merging, force-directed animation, live run streaming, and cross-run merged graphs are outside the first viewer. Runs remain comparable side-by-side through the selector and summaries.
