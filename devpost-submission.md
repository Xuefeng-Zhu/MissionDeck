# Title

MissionDeck

## One-line Summary

MissionDeck is a release-readiness agent for small product teams: it reconciles requirements, engineering status, and customer feedback, asks for the one launch tradeoff that needs human judgment, then produces a cited launch pack that honors the decision.

## Problem

Small product teams make launch calls from evidence scattered across requirement notes, engineering updates, and customer feedback. These sources often disagree. Someone has to find the conflict, judge the risk, decide what can be promised, and make every downstream artifact consistent with that choice.

That work is repetitive but not mindless. A generic summary can reduce reading time, but it does not preserve which evidence supported a recommendation, who made the consequential decision, or whether the final checklist and announcement actually followed it.

## Solution

MissionDeck provides one bounded release-readiness workflow:

1. A person reviews three named source snapshots.
2. A Strands graph extracts exact evidence, runs readiness and risk agents concurrently, and joins them into a cited decision brief.
3. MissionDeck interrupts only at the real decision. The reviewer chooses an option and records constraints.
4. MissionDeck saves a version-bound **Decision Receipt** and starts a fresh Strands invocation to produce the launch pack.
5. The coordinator saves and reads back the launch brief, checklist, announcement draft, risks, and change summary, then asks a person to verify the outcome.

If a source changes, the earlier receipt remains in history but no longer authorizes a new output. MissionDeck reruns analysis and requires a new decision.

## Why This Matters

The target user is a product lead, founder, engineering lead, or release owner on a small team. MissionDeck makes that person faster without pretending the consequential tradeoff can be outsourced. The agent does the high-volume reconciliation; the person retains judgment and accountability.

The result is a more credible launch process: claims are tied to reviewed excerpts, risks stay visible, and the final announcement can be traced to the human decision that shaped it.

## How We Used AI

MissionDeck uses the Strands Agents SDK for a non-trivial, bounded multi-agent workflow:

- An **evidence agent** retrieves reviewed source snapshots through mission-scoped read tools and emits structured, cited findings.
- **Readiness** and **risk agents** analyze those findings concurrently.
- A **synthesis agent** waits for both branches and creates the decision brief with options, consequences, and a recommendation.
- After the human gate, a fresh **launch-pack agent** receives the saved decision and produces artifacts that must reflect its constraints.

The default model transport is Amazon Bedrock Converse with Amazon Nova 2 Lite through the US geo inference profile `us.amazon.nova-2-lite-v1:0` in `us-west-2`. AWS authentication uses the standard credential chain, preferably a least-privileged runtime IAM role. OpenRouter and direct OpenAI remain explicit opt-in alternatives. The model cannot write provider records directly. MissionDeck validates structured outputs and literal source citations; the durable coordinator owns state changes, idempotency, budgets, external writes, read-back, and recovery.

## How We Used Codex

Codex was used as a development collaborator to inspect the existing product, review architecture and hackathon fit, implement the Strands workflow and user experience, add regression coverage, run local/browser verification, and prepare evidence-aware submission materials. The implementation preserved an auditable Git history and separated controlled SDK tests, fixture workspace runs, real-model rehearsals, connected provider proof, and public deployment proof instead of treating them as interchangeable.

## Key Features

- Fixed release-readiness workflow: **Analyze → Human decision → Produce launch pack**.
- Real Strands Graph with concurrent readiness/risk branches and a synthesis join.
- Read-only mission tools bound to the current source revision.
- Exact-excerpt citations validated before analysis is accepted.
- Decision Receipt binding the evidence revision, selected option, and human constraints that gate downstream output.
- Source-change invalidation with historical artifact retention.
- Durable leases, idempotency, run budgets, cancellation, retry, and uncertain-write recovery.
- Journaled document persistence with provider read-back.
- Chrome side panel and full workspace with execution progress and human verification.
- Visible fixture/live labels with no silent fallback.

## Architecture

The Strands graph performs read-only analysis; MissionDeck owns durable authority.

`Reviewed sources → durable coordinator → evidence agent → readiness + risk agents → synthesis → Decision Receipt → fresh launch-pack invocation → journaled document write/read-back → human outcome verification`

Required upload asset: [`docs/architecture.png`](docs/architecture.png). Editable source: [`docs/architecture.svg`](docs/architecture.svg).

## Testing Instructions

Requirements: Node.js 22+ and pnpm 10.32.1.

```sh
corepack pnpm install --frozen-lockfile
cp -n .env.example .env
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm exec playwright install chromium
```

For deterministic adaptive browser coverage:

```sh
corepack pnpm test:adaptive
```

The adaptive suite includes a headful Chrome side-panel check and therefore requires a graphical desktop session.

For manual Strands output, set `MODEL_MODE=live` and use the default Bedrock configuration (`MODEL_PROVIDER=bedrock`, `AWS_REGION=us-west-2`, `BEDROCK_MODEL_ID=us.amazon.nova-2-lite-v1:0`) with AWS authentication available through the standard credential chain. Keep `PROVIDER_MODE=fixture` for clearly labeled local records, run `corepack pnpm dev`, pair the browser, choose **Run the Harbor review**, inspect the source packet, and select **Start launch review**.

Detailed evidence boundaries and optional connected steps are in [`docs/submission-evidence.md`](docs/submission-evidence.md) and [`docs/adaptive-launch.md`](docs/adaptive-launch.md).

## Public Demo Link

https://missiondeck-tb8e.onrender.com

The hosted judge flow is configured for Amazon Nova 2 Lite on Bedrock with a clearly labeled fixture workspace. Verify one complete public workflow on the exact deployed commit before final submission.

## Public Repository Link

https://github.com/Xuefeng-Zhu/MissionDeck

The repository is public and includes an MIT license. Before final submission, verify that the exact submission build is on the public default branch.

## Demo Video

**TODO before final submission:** record a current MissionDeck/Bedrock demo, upload it to YouTube or Vimeo, confirm signed-out playback, and add its URL here.

Do not publish the earlier local `Mission Control` recording: it has no audio and its retained run manifest identifies OpenRouter rather than Bedrock. Generated evidence is intentionally gitignored. The replacement must be at most five minutes, keep labels readable, and accurately name every model/workspace evidence layer shown.

Suggested outline:

- **0:00–0:25 — Problem and user:** scattered launch evidence forces small teams to repeat a judgment-heavy reconciliation.
- **0:25–1:05 — Sources:** show the editable Harbor requirements, engineering, and customer-feedback snapshots and the conflicting calendar promise.
- **1:05–2:10 — Agent work:** start the review; show the declared evidence layer, evidence extraction, parallel readiness/risk, synthesis, citations, and bounded activity.
- **2:10–3:10 — Human decision:** inspect consequences, choose an option, add the constraint “Disclose manual date entry; do not promise calendar integration,” and save the Decision Receipt.
- **3:10–4:05 — Result:** show the launch brief, checklist, announcement draft, risks, and the “what changed” summary.
- **4:05–4:35 — Revision proof:** change engineering status, show the old decision become stale, and explain that a fresh decision is required.
- **4:35–4:50 — Close:** recap who it helps and why human accountability plus durable evidence matters.

## Screenshot Shot List

1. Source review with the three named Harbor snapshots and visible evidence-layer labels.
2. Strands progress showing readiness and risk in parallel.
3. Decision brief with exact citations, options, consequences, and recommendation.
4. Decision Receipt with the selected option and recorded constraint.
5. Launch-pack results showing what changed because of the decision.

Do not show pairing codes, tokens, `.env` contents, private provider data, or unrelated browser tabs.

## Submission Readiness Notes

The verified Bedrock/Render build is published on the public repository's default branch. The packet includes the MIT license, README, editable architecture SVG, upload-ready architecture PNG, Devpost copy, evidence matrix, and final checklist. An existing Devpost pre-draft is still untitled and has not been submitted.

Still required before the final Devpost action:

- upload the architecture PNG in the required file field;
- add the AWS Builder ID;
- publish the final video on YouTube or Vimeo and confirm public playback;
- add a live-demo URL only if the deployed app was verified end to end;
- supply the remaining official form answers; and
- perform a final secret, link, and evidence-label review.

Nothing in this file is sent to Devpost automatically.

### Prior-work disclosure

MissionDeck builds on mission planning, browser context, and durable human/agent coordination work created before this submission. Hackathon-specific work adds the release-readiness product focus, Strands multi-agent graph, revision-bound sources and citations, Decision Receipt, source-change invalidation, launch-pack generation, execution graph, adaptive browser/native-side-panel coverage, and submission experience. The repository history is intentionally retained.

## Known Limitations

- The agent is specialized for release readiness, not arbitrary mission planning.
- A fixture workspace proves local orchestration, not native Ambiguous delivery.
- A controlled model transport proves SDK graph behavior, not live-model quality.
- Public deployment and live-provider acceptance require their own evidence.
- The generated announcement is a draft and is never sent automatically.
- A source change waits for idle durable state, then requires a new analysis and human decision.

## TODO Official Form Fields

Live requirements fetched from Devpost on 2026-09-14:

- **Submitter Type:** proposed **Team of Individuals** based on the owner-confirmed Xuefeng Zhu/Lingyi Kong team; confirm before the Devpost update.
- **Country of Residence:** United States — confirm in the final form.
- **Organization name:** Leave blank unless applicable.
- **Track:** Professional Agents.
- **Public code repository:** https://github.com/Xuefeng-Zhu/MissionDeck
- **Architecture diagram:** upload `docs/architecture.png`.
- **AWS Builder ID:** TODO — user-controlled value.
- **Live demo URL:** TODO if a deployment is verified; optional.
- **Testing instructions:** use the draft above, adjusted to match the final public build.
- **Optional builder.aws.com post:** leave blank unless a published post is available before the deadline.
- **Video URL:** TODO — public YouTube or Vimeo URL required.

The current official form does not ask for a Codex session ID.
