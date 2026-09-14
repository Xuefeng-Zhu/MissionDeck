# Mission Control

**Humans and AI agents, working toward one mission.**

Mission Control helps small teams tackle ambitious projects by combining agent execution with human judgment. Large projects involve dependent tasks, changing requirements, and decisions that need people. A shared mission connects those pieces so each contributor can build on the work that came before.

**Product goal:** State a mission, break it into tasks in **Ambiguous.ai**, and assign each task to a specific human or agent. Start eligible agent work automatically, use human feedback to move the project forward, and keep drafts, evidence, reviews, and final artifacts in Ambiguous, linked to their tasks and mission. See the [mission execution requirements and acceptance scenario](docs/mission-execution.md).

## From mission to shared work

1. **Define the outcome.** Describe the mission, constraints, and what successful completion looks like.
2. **Break down and assign the work.** Give each task an owner, dependencies, an expected deliverable, and completion criteria. Agents handle supported drafting and synthesis; humans contribute decisions, missing information, and review.
3. **Coordinate execution and handoffs.** Ready agent tasks start automatically. Completed prerequisites and human feedback release the next steps, carrying the relevant context forward.
4. **Keep the work together.** Ambiguous is the shared home for tasks and artifacts. Drafts, evidence, and review results stay connected to the mission so contributors can find and reuse them.
5. **Verify the outcome.** Check the deliverables against the mission's required results, with human verification where needed.

For example, a product-launch mission can move from an agent's positioning draft to a human's review, then to an agent's final launch brief. That handoff is the first implemented flow toward coordinating larger projects across people and agents.

The Chrome side panel keeps the mission beside the pages where requirements and feedback appear. Users select and review browser context before sharing it. Mission Control coordinates the work; Ambiguous keeps the shared tasks and outputs accessible beyond a single conversation.

## Current scope

The current implementation includes a Manifest V3 Chrome side panel and a durable server worker for the first complete execution flow: draft from supplied context, hand off to a human, then produce a final document. Ambiguous holds the assigned tasks, dependencies, and shared documents. The server runs the selected model for the assigned agent; it does not launch a native Codex or Hermes process. This repository is named MissionDeck; the product is Mission Control.

The **Adaptive launch review** template adds real Strands agents for evidence extraction, parallel readiness and risk analysis, and a cited human decision brief. A saved decision releases the launch-pack task; changing reviewed sources creates a new revision and requires a fresh decision. Use the [adaptive launch guide and connected demo CLI](docs/adaptive-launch.md) for setup, the architecture, and a repeatable rehearsal. See [adaptive acceptance evidence](docs/adaptive-acceptance.md) for the checks actually completed.

## Run locally

Requires Node.js 22+ and pnpm 10.32.1.

```sh
pnpm install
cp -n .env.example .env
pnpm dev
```

Open `http://127.0.0.1:5173`. In a second terminal, run `pnpm pairing-code` and enter the code in Settings. The server listens only on `127.0.0.1:4318`; sessions are revocable and expire after 24 hours.

The default **fixture provider + fixture planner** are explicitly labeled simulations. Mission state is persisted in `.data/postgres` using PGlite, an embedded PostgreSQL engine. No OpenRouter, OpenAI, or Ambiguous call is silently replaced by a fixture response. Standard PostgreSQL is supported with the included Docker Compose configuration.

For live planning and CopilotKit conversation, the default model vendor is **OpenRouter**: configure `MODEL_MODE=live`, `MODEL_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL` on the server. The default model is `openai/gpt-5.6-luna`. Direct OpenAI remains available with `MODEL_PROVIDER=openai`, `OPENAI_API_KEY`, and `OPENAI_MODEL`. Task provider mode is independent; keep `PROVIDER_MODE=fixture` to test real model responses against simulated tasks. See [setup](docs/setup.md) before enabling live task writes.

## Load the extension

```sh
pnpm build
```

Open Chrome's extensions page, enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`. Click Mission Control's toolbar icon on a web page, pair the extension in Settings, then choose **Capture page**. Selection context menus offer Add to mission, Create task, and Check mission impact. Every capture opens an editable preview before transmission. An extension-owned full workspace is available from the panel header.

## What is implemented

- Mission start with real workspace human/agent selection, dependency-gated drafting runs, human review, and final outcome verification.
- Native Ambiguous task assignment, dependency edges, restricted documents shared with selected participants, and verified artifact read-back.
- Durable execution journals, worker leases, run budgets, pause/resume/cancel, reassignment, and uncertain-write reconciliation.
- Editable mission contracts and exact deadlines, with required and optional criteria.
- Plan review with editable tasks, dependencies, effort estimates, and explicit approval.
- A server-authoritative PostgreSQL state model, audit events, operation ledger, and durable outbox.
- Fixture task create/read/update and a narrow live Ambiguous adapter with identity checks, read-back, conflict detection, and unknown-outcome handling.
- CopilotKit v2 context, frontend proposal/navigation tools, six controlled review components, human feedback, and authenticated runtime; OpenRouter or direct OpenAI structured plan/evidence generation when configured.
- Accepted evidence deduplication, missing video requirement demo, blockers, capacity scheduling, recovery diffs, and human verification.
- Minimum extension permissions, private draft/form exclusions, secret screening, expiring capture inbox, and manual fallback.

Choose **New mission → Try a sample mission → Start mission** for the launch-brief flow. Ready agent tasks run automatically; the human review releases the final drafting task. The first runner supports text drafting and synthesis from supplied material. Browsing, coding, publishing, and sending remain human work; the separate Trigger.dev/Exa research worker is still disabled. The older planning-only workflow retains its explicit proposal reviews.

The complete execution flow is verified with an isolated fixture backend and Chrome. A separate real-model rehearsal completed planning, drafting, human-review handoff, and final synthesis against fixture storage. Live Ambiguous identity/roster discovery is verified; live task/document writes require a connected rehearsal. Workspace and model modes remain visibly labeled. See [the demo operator guide](docs/execution-demo.md) and [execution API evidence](docs/execution-api-discovery.md).

## Documentation and checks

- [Mission execution product requirement](docs/mission-execution.md)
- [Launch-brief execution demo](docs/execution-demo.md)
- [Strands adaptive launch guide and demo CLI](docs/adaptive-launch.md)
- [Adaptive launch acceptance evidence](docs/adaptive-acceptance.md)
- [Setup and live smoke workflow](docs/setup.md)
- [Verified integration capabilities and package versions](docs/integrations.md)
- [Architecture and field ownership](docs/architecture.md)
- [Privacy, retention, and deletion](docs/privacy.md)
- [Two-minute demo and manual extension checks](docs/demo.md)
- [Test report and limitations](docs/tests.md)
- [Design fidelity review](docs/design-review.md)

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

The test report distinguishes executed local checks, fixture behavior, unpacked Chromium coverage, remaining manual Chrome checks, and unverified live providers. No extension publication or deployment is performed.

## Workspace/context upgrade

The incremental upgrade adds selected browser sources, opt-in Live Assist, connected artifact review and consented routine suggestions while preserving the original task workflow. Start with [the Launch Review fixture demo](docs/upgrade-demo.md), [capability/access matrix](docs/ambiguous-capabilities.md), [browser privacy](docs/browser-context-privacy.md), and [native workflow mapping](docs/native-workflow-mapping.md). See [verification results](docs/tests.md#workspace-upgrade-verification) for local coverage and remaining acceptance gaps. `WORKSPACE_UPGRADE_ENABLED=false` disables the added routes and navigation. No native routine activates on startup.
