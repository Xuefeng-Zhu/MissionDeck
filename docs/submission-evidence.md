# Submission evidence matrix

This page records what each MissionDeck proof artifact establishes. It deliberately avoids turning a passing local test, a controlled model transport, or fixture storage into a claim about a real model, public deployment, or native provider delivery.

## Current claim boundary

| Layer | What is implemented or recorded | What it does **not** prove |
| --- | --- | --- |
| Product code | Fixed adaptive launch workflow, revision-bound sources, Decision Receipt, launch-pack generation, durable coordinator, and workspace adapter | That a particular deployment or credential configuration is healthy |
| Strands SDK tests | Real Strands Graph and tool machinery exercised against a controlled model transport, including parallel join behavior, structured output validation, failure/cancellation, and budgets | Live selected-model quality or availability |
| Coordinator tests | Durable source/decision lifecycle, idempotency, leases, retries, budget reservations, cancellation, uncertain writes, and historical artifacts against fixture workspace records | Native Ambiguous writes or sharing |
| Browser tests | Full workspace and actual MV3/native-side-panel surfaces exercised with a controlled runner and fixture workspace, including narrow layouts, reload, revisions, decisions, artifacts, and verification | Live model calls or public internet availability |
| Real-model rehearsal | **Pending in the checked-in acceptance record** | No live-model claim should be made until provider/model, timestamp, run IDs, source revision, and accepted outputs are retained |
| Connected Ambiguous acceptance | **Pending in the checked-in acceptance record** | Fixture IDs or authenticated read-only discovery are not proof of task/document writes |
| Public deployment | **Pending until a public URL is deployed and verified** | Localhost health and production builds are not public-demo proof |

## Final rebuild verification

The final rebuild candidate was verified on September 14, 2026:

- 390 tests across 36 files passed, including the PR-review regressions for bounded dispatch, URL handling, and hardened CLI session reuse;
- full-repository TypeScript and the production extension/server build passed;
- both public-demo and private-hosted web bundles passed, with the public JavaScript bundle at 431.61 kB (128.17 kB gzip);
- the public-demo Docker image built successfully and `render.yaml` parsed successfully;
- 6/6 adaptive browser scenarios passed, including the actual headful Chrome side panel;
- the separate persisted execution scenario passed in Chromium on an isolated local port;
- the real Strands SDK was exercised with a controlled model transport; and
- the browser runs used a controlled runner and fixture workspace.

The initial sandboxed unit run could not bind localhost (`listen EPERM`); the same suite passed outside that socket restriction. The first execution smoke also found an unrelated existing developer server on its default port, so the final passing run used the documented isolated-port override without stopping that process.

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm --filter @mission/extension build:web
VITE_PUBLIC_DEMO_BUILD=true corepack pnpm --filter @mission/extension build:web
docker build -t missiondeck-agents-demo:verify .
corepack pnpm test:adaptive
MISSIONDECK_EXECUTION_TEST_PORT=5187 corepack pnpm test:execution
git diff --check
```

## Final evidence ledger

Complete this table on the exact public submission commit.

| Evidence | Required record | Status |
| --- | --- | --- |
| Public source | Default-branch commit SHA, public URL, MIT license detected | Review branch and MIT file ready; default-branch merge and GitHub detection TODO |
| Unit/integration | Command, test count, timestamp, exit 0 | Ready locally: 390/390 across 36 files on September 14, 2026 |
| Production build | Command, timestamp, exit 0, warnings summarized | Ready locally: typecheck, extension/server, both hosted modes, Docker image, and Render YAML passed; private Copilot bundle retains existing large-chunk warnings |
| Browser | Scenario count, surfaces, viewport(s), timestamp | Ready on controlled/fixture layers: 6/6 adaptive plus 1/1 persisted execution; 1440×1000 workspace and native Chrome side panel on September 14, 2026 |
| Real model | Vendor, model, timestamp, mission/run IDs, source revision, bounded counters | TODO or explicitly omit claim |
| Live workspace | Actual task/document IDs, assignees, restricted sharing, content read-back timestamps | TODO or explicitly omit claim |
| Public demo | URL, `/health` result, cold-start check, one complete judge flow | Container ready locally; public URL and deployed judge flow TODO or leave optional field blank |
| Video | Public URL, runtime ≤ 5:00, playback checked signed out | TODO |
| Architecture | `docs/architecture.png`, readable at upload preview size | Ready locally; upload TODO |

## Evidence-label vocabulary

Use these exact meanings in the UI, README, video, and Devpost copy:

- **Controlled model transport:** the real Strands SDK executed, but model responses were supplied by a deterministic test transport.
- **Fixture workspace:** MissionDeck persisted simulated provider tasks/documents locally; no native Ambiguous write occurred.
- **Live model:** an actual request reached the named configured model and its output passed MissionDeck validation.
- **Connected workspace:** provider tasks/documents were written, read back by real IDs, and their assignees/access were verified.
- **Public demo:** a judge-accessible URL completed the stated workflow; a local build is insufficient.

## Demo evidence handling

Generated videos, screenshots, request journals, and exports under `artifacts/demo-video/` are gitignored by design. Before sharing any asset:

1. Verify its mode labels and narration match the actual run.
2. Remove pairing codes, session tokens, credentials, private source text, and unrelated tabs.
3. Confirm the video runtime and public playback.
4. Preserve a private checksum and run journal for reproducibility.
5. Link only public, judge-accessible assets from Devpost.

For detailed historical evidence, see [adaptive acceptance](adaptive-acceptance.md). For the repeatable operator flow and connected evidence fields, see [adaptive launch](adaptive-launch.md).
