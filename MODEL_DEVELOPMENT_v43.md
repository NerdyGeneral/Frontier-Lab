# Frontier Lab — model development update

Build and content version: **0.33.0**. This update continues the uploaded v42
workspace changes. The docked task pages, usable sidebar and clock, retained task
drafts, and locked-tab explanations are preserved.

## A. Three additional model skills

Models can develop **Reasoning**, **Long context**, and **Multimodal** skills
alongside Conversation, Documents, Coding, and Tool use. Data offers now include
specialist examples for each new skill and three cross-domain corpus editions.
Buy and prepare relevant data before adding it to a custom training run.

The paid **Reasoning, context & multimodal** evaluation uses 60 held-out cases:
20 for each advanced skill. Models and reports show earned scores separately
from test results. This evaluation measures the new skills; the ordinary
capability test still determines release eligibility.

## B. Calculate and train your own model design

Open the training bench and choose **Design your own**. Select a starting model
and prepared datasets, then choose:

- Adaptation of that model, or a new foundation.
- Model family and parameter count for a new foundation.
- Sparsity, subject to Sparse architecture research and compatible hardware.
- Relative priorities across all seven skills.
- The amount of compute work the run must complete.

The forecast calculates targets from size, sparsity, compute, training priorities,
and available Architecture research. Prepared evidence and its quality determine
how much potential the training earns. It shows seven expected skills, setup
costs, required memory, design work, and serving cost implications. A data-mix
slider does not supply missing examples. Additional training work has diminishing
returns and must actually finish before its gains are earned.

Adaptation keeps the starting model's size and architecture. A foundation creates
a separate lineage. Training produces a new saved version; releasing or switching
a live product remains a separate action. Equivalent training plans cannot be
renamed or rescaled to reroll their results.

The opening campaign keeps its guided first-training path. After the first model
finishes, the bench defaults to the custom designer. **Training methods** retains
the existing guided and specialized methods. Both modes keep their task drafts
when navigating around the workspace.

## C. Repeatable Architecture research

After **Evaluation suite (R1)**, fund an Architecture research iteration in
Research. Each iteration requires its own fee, Research points, and compute.
Finish both work meters and advance to the next week to use the discovery.

| Research level | New option |
| --- | --- |
| 1 | Edge family: smaller models with a low memory footprint. |
| 2 | Additional design potential for future custom training. |
| 3 | Frontier family: an engineering tier beyond large models. |
| Later iterations | Further design potential with diminishing returns and increasing requirements. |

The program remains repeatable after the family unlocks. Research improves learning
for a given compute budget and reduces serving work for new foundation designs,
with diminishing returns. It applies to new training plans and does not change
an existing model's saved scores. Medium,
large, and frontier foundation designs also require Checkpoint automation (R3);
sparse designs retain their own research and hardware requirements.

**Design frontier rating** is an engineering-scale index and can exceed 100.
The seven skill scores remain on their 0–100 benchmarks. A larger index is not
a substitute for a paid evaluation or a guarantee of better commercial results.

## Existing campaigns and saves

Supported earlier saves are validated and upgraded to content 0.33.0 while
retaining their existing models, training plans, progress, and financial records.
Historical models begin without earned advanced skills; develop them through new
training. The save schema remains 5, with new feature records identified by the
new content version.

Campaigns still save in the browser that played them. Use **Download save** to
back up a campaign or move it between browsers, and **Load save** to import it.
The project source ZIP and an exported campaign JSON are separate files.
