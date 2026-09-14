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

The Bedrock/Nova 2 Lite rebuild candidate was verified on September 14, 2026:

- 406 tests across 39 files passed, including the Bedrock transport, Nova model-adapter, bounded dispatch, URL handling, and hardened CLI session-reuse regressions;
- full-repository TypeScript and the production extension/server build passed;
- the prior container/fixture health smoke remains historical evidence; the Nova adapter tree is verified by the production build and awaits the hosted Render build;
- `render.yaml` passed Render's published Blueprint schema validation;
- the earlier rebuild's 6/6 adaptive browser scenarios and separate persisted execution scenario remain useful controlled/fixture evidence, but have not yet been rerun on the final public commit;
- the real Strands SDK was exercised with a controlled model transport; and
- no live Bedrock request or public Render workflow is claimed by these checks.

The initial sandboxed unit run could not bind localhost (`listen EPERM`); the same suite passed outside that socket restriction. The first execution smoke also found an unrelated existing developer server on its default port, so the final passing run used the documented isolated-port override without stopping that process.

```sh
corepack pnpm typecheck
npm test
corepack pnpm build
docker build -t missiondeck:bedrock-render-smoke .
git diff --check
```

## Final evidence ledger

Complete this table on the exact public submission commit.

| Evidence | Required record | Status |
| --- | --- | --- |
| Public source | Default-branch commit SHA, public URL, MIT license detected | Bedrock/Render build is on public `main` and the MIT file is exposed; record the final SHA after any last submission patch |
| Unit/integration | Command, test count, timestamp, exit 0 | Ready locally: 406/406 across 39 files on September 14, 2026 |
| Production build | Command, timestamp, exit 0, warnings summarized | Ready locally: typecheck and extension/server build passed; the hosted Render build is pending; the private Copilot bundle retains existing large-chunk warnings |
| Browser | Scenario count, surfaces, viewport(s), timestamp | Earlier controlled/fixture evidence: 6/6 adaptive plus 1/1 persisted execution at 1440×1000 and in the native Chrome side panel; rerun on the final public commit TODO |
| Real model | Vendor, model, timestamp, mission/run IDs, source revision, bounded counters | TODO or explicitly omit claim |
| Live workspace | Actual task/document IDs, assignees, restricted sharing, content read-back timestamps | TODO or explicitly omit claim |
| Public demo | URL, `/health` result, cold-start check, one complete judge flow | Public URL exists; exact Nova deployment, live Bedrock call, and deployed judge flow remain TODO |
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
