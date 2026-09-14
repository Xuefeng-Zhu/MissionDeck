# Adaptive launch acceptance evidence

Recorded September 14, 2026 (America/Los_Angeles).

This record separates implementation checks from live delivery. A controlled model transport exercises the real Strands SDK, while fixture workspace records simulate Ambiguous. Neither establishes real-model quality or actual Ambiguous delivery. Browser evidence below records the specific browser surfaces exercised.

## Execution graph increment

The final execution graph browser suite passed **4/4 tests in 1.4 minutes** against the rebuilt frontend. Together with the separate generic browser regression, **5/5 browser scenarios passed**. The adaptive suite used the controlled runner, fixture workspace, and the normal three-second UI polling interval. The dedicated graph test passed in 30.0 seconds; the existing adaptive workspace (13.0 seconds), unpacked MV3 (4.1 seconds), and native side-panel (19.7 seconds) tests also passed. This browser harness does not instantiate the Strands SDK or make live model/Ambiguous calls.

| Surface or behavior | Verified evidence |
| --- | --- |
| State adapter | 20 tests covering parallel agents, failed joins, decision saving, write uncertainty, cancellation, retries, pause, superseded activity, truncated detail, and older records. |
| Strands SDK | 17 real SDK tests with a controlled model transport, including accepted-result outcomes, failure/cancellation, correlated tools, parallel joining, and budgets. |
| Durable coordinator | 21 fixture integration tests covering source/decision lifecycle, interrupted work, uncertain delivery, and durable terminal cancellation. |
| Parallel graph | Both readiness and risk were held active; releasing readiness alone did not start synthesis. Releasing risk allowed synthesis. |
| Interaction and refresh | Keyboard node selection, reduced motion, three correlated source-tool outcomes marked succeeded, visible stale refresh/recovery, and delayed older failure/success responses that could not replace a newer graph state. |
| Workspace and narrow layout | 1440- and 390-pixel widths without horizontal overflow; graph snapshots show parallel analysis, human waiting, and verified delivery. |
| Durable workflow | A verified saved decision preceded launch-pack generation; documents saved still awaited human verification. Revision 2 reset earlier success, retained task/artifact identities, and required a fresh decision. Reload preserved the final verification without repeated runs. |
| Native Chrome side panel | A visible 360×625 native target exercised revision-2 parallel branches and the join, saved the revised pack, reloaded, and completed human verification. |
| Generic mission compatibility | The existing isolated generic fixture browser workflow passed 1/1 in 7.3 seconds (13.5 seconds including setup), covering saved output, human feedback, verification, and reload. |
| Full regression | 364 tests across 31 files passed in 47.78 seconds, including the graph, SDK, coordinator, and existing suites. |
| Build and types | Production build, full-repository TypeScript, separate adaptive browser TypeScript, and `git diff --check` passed. Existing Vite externalization/chunk-size warnings remain. |

Graph mission `4118d599-5d2e-4bc2-bebd-810693250716` completed source revision 2 with four controlled outer runs, 10 model-call reservations, 12 tool-call reservations, and 17 artifacts. Native mission `3411eb34-5d8b-446e-9e53-cf6345c720f9` completed both revisions with two decisions and four controlled outer runs. These are isolated fixture identifiers.

Retained local evidence: [graph run result](../artifacts/demo-video/execution-graph-acceptance/execution-graph-browser-result.json), [parallel workspace](../artifacts/demo-video/execution-graph-acceptance/execution-graph-parallel-desktop.png), [parallel narrow layout](../artifacts/demo-video/execution-graph-acceptance/execution-graph-parallel-sidepanel-width.png), [human waiting](../artifacts/demo-video/execution-graph-acceptance/execution-graph-human-waiting.png), [verified workspace](../artifacts/demo-video/execution-graph-acceptance/execution-graph-verified-desktop.png), [verified narrow layout](../artifacts/demo-video/execution-graph-acceptance/execution-graph-verified-sidepanel-width.png), [native parallel graph](../artifacts/demo-video/execution-graph-acceptance/execution-graph-native-parallel.png), and [native run result](../artifacts/demo-video/execution-graph-acceptance/adaptive-native-sidepanel-result.json). Screenshot evidence is generated outside Git. The graph is live state visualization; historical playback is not implemented.

## Adaptive implementation baseline

The following checks and video were recorded before the execution graph increment; they remain evidence for their stated earlier implementation layer.

| Layer | Evidence | Status |
| --- | --- | --- |
| Strands SDK | Real SDK Graph with controlled model transport; parallel analyses, scoped tools, structured outputs, cancellation and limits. A failed risk branch prevents synthesis even after readiness succeeds. | 14 tests passed, including the final specialist-failure regression. |
| Durable coordinator | Source versions, human gate, decisions, cancellation, restart, uncertain writes, lease takeover, reassignment sharing and concurrent budget reservations against fixture tasks/documents. | 19 tests passed. |
| Source boundaries | Named snapshot limits, provenance, accepted excerpts, exact citations and source instructions treated as data. | 7 tests passed. |
| Demo CLI | Controlled loopback HTTP mock with lost responses, stale updates, no-write previews, bounded verification replay and private export checks. | Temporary harness and retained three-test suite passed (3/3). |
| Full regression suite | All existing and adaptive Vitest suites, including paired API tests. | 338 tests across 30 files passed (34.17 seconds), followed by the expanded 14-test SDK suite; 339 distinct tests passed across these runs. |
| Type checking/build | Whole repository, separate browser harness TypeScript check, extension client/worker build, and server check. | Passed; existing Vite externalization/chunk-size warnings remain. |
| Adaptive browser | Full workspace at 1440/390 pixels: two revisions, two decisions/packs, exact accepted-excerpt import, activity, historical artifacts, reload, completion and reopening. Unpacked MV3 runtime: service worker, pairing session and navigation survive reload. | 2 tests passed (23.5 seconds); no console errors or horizontal overflow. |
| Native side panel | Actual headful Chrome side panel at 360×625, opened through a real click and `chrome.sidePanel.open`: decision, pack, source edit, fresh decision, revised pack, reload, expanded artifact and final verification. | 1 test passed (15.6 seconds); visible native target, no overflow, no duplicate runs. |
| Recorded flow | Selected-window ScreenCaptureKit recording of the isolated Chrome window: template and sample, first decision/pack, native side panel, revised source, fresh decision/pack, reload, artifact review, and final verification. | 40.02-second H.264 MP4, 1920×1012, 1,172 frames, no dropped frames; silent by design. |
| Generic browser | Existing sample mission, human feedback, saved outputs, verification and reload against isolated fixture storage. | 1 test passed (14.3 seconds). |
| Real-model rehearsal | Actual selected model calls through the Strands Graph, with storage mode recorded. | Pending. |
| Connected acceptance | Dedicated mission with live Strands calls and actual Ambiguous task, document, and sharing read-back. | Blocked: required connected model/workspace configuration is unavailable in this environment. |

The connected acceptance milestone remains open. This checkout has no configured selected-model key or Ambiguous key/expected identity, and no backend was reachable on its default port. Supply the existing environment-file path or configure the local `.env` before the authorized live demo. Credentials must stay out of chat and evidence files. The operator sequence and diagram are in the [adaptive launch guide](adaptive-launch.md).

Controlled browser run `c852c3aa-9ce7-4a52-861c-dac6cfcead90` retained all three task IDs across source revisions 1 and 2, made four controlled outer runs, retained 18 artifacts, and ended reopened with no outcome attestation. Exact imported evidence ID: `9768394d-788e-467a-8243-49a7a8a60235`. These IDs belong to the isolated fixture database.

Local generated evidence is retained outside Git under `artifacts/demo-video/adaptive-acceptance/browser`: [full-workspace result](../artifacts/demo-video/adaptive-acceptance/browser/adaptive-browser-result.json), [extension result](../artifacts/demo-video/adaptive-acceptance/browser/adaptive-extension-result.json), [decision view](../artifacts/demo-video/adaptive-acceptance/browser/adaptive-decision-desktop.png), and [390-pixel unpacked view](../artifacts/demo-video/adaptive-acceptance/browser/adaptive-unpacked-extension-390px.png). The browser tests regenerate these outputs in their reported temporary result directory.

Native panel mission `9eebbcc0-f5c3-4b2b-8fc5-559346272179` completed source revisions 1 and 2 with two saved decisions and four controlled runs. The separate native page target was attached through CDP, and only its loopback `/api/` traffic was forwarded to the isolated test backend. Its [result record](../artifacts/demo-video/adaptive-acceptance/browser/adaptive-native-sidepanel-result.json), [target evidence](../artifacts/demo-video/adaptive-acceptance/browser/native-sidepanel-targets.json), and [expanded revised artifact](../artifacts/demo-video/adaptive-acceptance/browser/adaptive-native-sidepanel-final-artifact.png) show the exercised container and persisted result. The normal toolbar icon was not clicked; the real side-panel container was opened by the same browser API after a test-page click. This remains controlled model/fixture-storage evidence.

The complete silent recording is saved locally as [adaptive-complete-flow-2026-09-14.mp4](../artifacts/demo-video/adaptive-complete-flow-2026-09-14.mp4), with a readable portrait crop at [adaptive-complete-flow-2026-09-14-focused.mp4](../artifacts/demo-video/adaptive-complete-flow-2026-09-14-focused.mp4). The full-window SHA-256 is `5afb82d0134e61e9d0904a2b55a8a654ef67313eb5e0e2a97ec254ac680091e7`; the focused cut is `402970f73090d6ec1f016e8ae2443700c580990c4fba7fb384bfe7b3691fe6e6`. The capture excludes system audio and microphone input. The UI visibly labels the deterministic controlled runner and fixture workspace; this video does not claim real-model or live Ambiguous acceptance.

## Repeatable checks

```sh
corepack pnpm typecheck
corepack pnpm exec tsc -p tests/browser/tsconfig.adaptive.json --noEmit
corepack pnpm test
corepack pnpm build
corepack pnpm test:adaptive
MISSIONDECK_EXECUTION_TEST_PORT=5177 corepack pnpm test:execution
node --import tsx scripts/adaptive-demo.ts --help
```

The CLI regression uses a loopback-only mock server and does not contact a model or Ambiguous. Its synthetic `live` responses test mode handling; its exports are test data and cannot satisfy connected acceptance.

Browser verification used the locally cached Chromium revision 1243 via `PLAYWRIGHT_CHROMIUM_EXECUTABLE`; use an installed compatible Chromium executable or install Playwright's pinned browser before running. API/browser checks need permission to bind loopback listeners. An initial generic browser attempt reused an existing development server on port 5173 and reached a blank screen; the isolated-port run above passed without changing that server.

## Connected evidence to retain

Use a dedicated live demo mission and preserve its request journal. Record the selected engine/provider/model, source revisions, actual assignee IDs, all three task IDs, analysis version, human decision, activity, cumulative budgets, current and historical artifact IDs/URLs, and read-back timestamps. Verify the final text and participant access directly in Ambiguous before recording outcome acceptance. Record an interrupted write only if encountered; do not deliberately destabilize a production write.

The CLI `export` command writes private local execution and artifact snapshots with an explicit evidence-layer label. It does **not** independently refresh Ambiguous content or permission reads. Its snapshots retain the backend's last verification timestamps. Keep tokens and credentials out of recordings and evidence exports.
