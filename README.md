# Mission Control

Your browser knows what you are looking at. Mission Control knows what you are trying to accomplish.

A Manifest V3 Chrome side panel for outcome-driven plans, explicitly accepted page evidence, persisted human approvals, and verified external task updates. This repository is named MissionDeck; the product is Mission Control.

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

- Editable mission contracts and exact deadlines, with required and optional criteria.
- Plan review with editable tasks, dependencies, effort estimates, and explicit approval.
- A server-authoritative PostgreSQL state model, audit events, operation ledger, and durable outbox.
- Fixture task create/read/update and a narrow live Ambiguous adapter with identity checks, read-back, conflict detection, and unknown-outcome handling.
- CopilotKit v2 context, frontend proposal/navigation tools, six controlled review components, human feedback, and authenticated runtime; OpenRouter or direct OpenAI structured plan/evidence generation when configured.
- Accepted evidence deduplication, missing video requirement demo, blockers, capacity scheduling, recovery diffs, and human verification.
- Minimum extension permissions, private draft/form exclusions, secret screening, expiring capture inbox, and manual fallback.

Task executors are proposed assignments. This MVP does not autonomously implement code, submit projects, publish content, or send messages. The phase-two Trigger.dev/Exa research worker remains disabled until the core live integration is verified.

## Documentation and checks

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
