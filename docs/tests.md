# Implementation and test report

Updated on **2026-09-12**. This is a historical OpenRouter-era test report: the execution implementation at that point passed **296 tests across 26 files**, TypeScript checking, and the production frontend and extension-worker builds. The latest isolated Chrome execution regression passed **1 test in 12.9 seconds**. A separate rehearsal completed the mission with OpenRouter-hosted GPT-5.6 Luna planning and drafting while retaining fixture storage. It is not evidence of the later Amazon Bedrock transport; a live Bedrock invocation remains pending. Authenticated native Ambiguous identity/roster reads and native deep-link formats are verified; native task/document write acceptance remains pending.

## Current execution evidence

| Layer | Result | Evidence and scope |
| --- | --- | --- |
| Complete local suite | 296 tests / 26 files passed | Includes durable execution, dependency gating, same-request start recovery, provider read-back, human review, reassignment, budgets, leases, cancellation, restart recovery, uncertain-write reconciliation, and outcome verification, alongside earlier product coverage |
| Transitive dependencies | Fixed and regression covered | Final drafting tasks consume verified artifacts from the full dependency chain, including earlier drafts when only the human review is a direct dependency |
| TypeScript and production builds | Passed | Latest `tsc --noEmit`, frontend bundle, and extension service-worker bundle; diff checks passed |
| Real server with fixture storage/model | Passed | Three completed tasks, two drafting runs, six unique verified documents, and all provider journal operations in `done`; no fake browser API responses |
| Latest Chrome regression | 1 test passed in 12.9 seconds | Fresh fixture backend and current sample defaults of 3 tasks / 4 agent runs; sample prefill, human gate across reload, final artifact containing saved feedback, final verification, persistence, and desktop/mobile layout |
| OpenRouter model with fixture storage | Passed historically | OpenRouter-hosted GPT-5.6 Luna planning plus two drafting-task calls; three completed tasks and six persisted documents; every provider operation verified. This does not prove Bedrock access. [Result](/private/tmp/missiondeck-live-model-result.json), [final brief](/private/tmp/missiondeck-live-model-final.md) |
| Failed planning attempt | Failed safely, then explicitly resumed | Initial planning failed before workspace writes. An explicit resume during the isolated rehearsal led to the successful plan; there was no automatic retry of the failed request |
| Native Ambiguous discovery | Read-only checks passed | Configured user/workspace matched; complete roster of one human and two agent identities was retrieved. This supersedes the historical no-key/no-identity notes below |
| Existing native task read | Passed without mutation | The adapter parsed an actual account task, fingerprint, and native URL. Its custom status and recurrence fields were null; native create/update behavior remains unverified |
| Native object links | Route formats verified read-only | Official app routing confirms `https://app.ambiguous.ai/tasks?task=<uuid>` and `https://app.ambiguous.ai/docs/<uuid>`; live adapter constructs links only from validated provider IDs. Fixture URLs remain null. [Discovery evidence](execution-api-discovery.md) |
| Native writes and native agent processes | Not performed | No execution-rehearsal task/document writes to Ambiguous, and no native Codex/Hermes process dispatch. Actual model work uses the bounded MissionDeck server text runner |

Provider mode and model mode are independent. `fixture` / `fixture` simulates both workspace records and model output. `fixture` / `live` performs actual model work while saving to local fixture storage. `live` / `live` would perform actual model work and native Ambiguous writes; only its authenticated read-only discovery has been verified so far. In this historical run, the local server passed its health check with fixture storage and OpenRouter live-model configuration. Configuration and health alone are neither native-write proof nor Bedrock proof.

The actual-model rehearsal's two agent runs count drafting tasks; planning attempts are separate. Review feedback and the final verification statement were synthetic test inputs, not the user's acceptance of a real deliverable. The final brief is text derived from fictional supplied notes and that review feedback, not evidence that an external product launch occurred. The runner supports bounded text drafting and synthesis, not arbitrary code execution, external browsing, publication, or outbound communications.

Run the dedicated real-server regression with `pnpm test:execution`. Its [configuration](../playwright.execution.config.ts) isolates backend API traffic on port 4321, refuses non-fixture provider/model modes before the UI opens and before every write, and writes screenshots/results under a unique temporary directory outside the repository. The normal live-capable backend on port 4318 receives no test API traffic. See [the execution demo](execution-demo.md) for the operator path and mode distinctions. The earlier route-mocked UI run separately covered uncertain-start replay, pause/resume, reassignment and reconciliation controls; those checks alone were not backend integration proof.

## Historical OpenRouter update snapshot

The following counts and implementation boundaries describe the earlier OpenRouter update on 2026-09-12. Its **129 tests across 9 files** and minimal live transport probe remain historical evidence, not the current suite total or the limit of current model verification. Claims below that keys or native identity had not yet been verified describe that earlier snapshot; current authenticated read-only discovery is recorded above. Full legacy CopilotKit streaming and native workspace write acceptance remain separate checks.

### Checks executed for that snapshot

| Layer | Result | Evidence and scope |
| --- | --- | --- |
| TypeScript | Passed | Root `tsc --noEmit`, covering domain, server, extension, shared UI, workers stub, and tests |
| Domain | 52 tests passed | Dependency validation, owner/capacity scheduling, generated DAG invariants, unknown estimates, required criterion coverage and optional upgrades, approval hash/revision/expiry, evidence deduplication/redaction, safe recovery, and completion verification |
| Page capture | 6 tests passed | Actual capture function in JSDOM: main text/selection, private forms and drafts, hidden content, 20,000-character truncation, source sanitization, and inbox validation |
| Timezones | 5 tests passed | Displayed IANA zone conversion independent of host zone, fractional offsets, invalid dates, DST gaps, and readable recovery dates |
| Provider adapter | 14 tests passed | Mocked official API responses verify discovery/identity, returned-ID read-back, supported patches, timeouts, unknown outcomes, conflicts, recurrence restrictions, redacted errors, and durable fixture idempotency |
| Approval service/database | 15 tests passed | No write before approval, double approval, stale/hash/scope checks, partial writes, unknown-outcome reconciliation, human edit conflicts, local blocker preservation, observed provider status, closed lifecycle guards, duplicate evidence, criterion verification, and disk-backed database close/reopen |
| Authenticated HTTP API | 8 tests passed | Real loopback HTTP server: anonymous access, wrong code, exact origins, extension pairing, revised proposals, forged mappings/attestations, safe configuration, revocation, and closed-mission retry guard |
| Real CopilotKit runtime adapter | 6 tests passed | Actual v2 runtime discovery, parsed-body bridge, complete synthetic stream through a mocked OpenRouter transport, selected endpoint/model, `store:false`, explicit direct OpenAI Responses path, and disabled/missing-key guards; no real model-provider invocation |
| Model vendor configuration and transport | 10 tests passed | OpenRouter default and explicit direct OpenAI selection, selected-key isolation, safe public metadata, fixture gating, strict schema requests, no vendor/fixture fallback, malformed output, and refusal/error handling using mocked transports |
| Structured model-result boundary | 13 tests passed | Strict parsed output, exact supporting excerpt, scoped IDs, optional-to-required upgrades, accepted task coverage, preserved estimates/dependencies/blockers, covered and uncertain outcomes, and invalid-result rejection; no model invocation |
| Production build | Passed | Extension UI and service worker bundled; server TypeScript build passed; approximately 17 MB with no source maps |

That complete Vitest run passed **129 tests across 9 files** after the OpenRouter changes. Tests used separate ephemeral databases and provider fixtures. The persistence test closed and reopened an actual disk-backed PGlite PostgreSQL database, then confirmed the same tasks, evidence, and provider IDs.

After that backend restart, `GET /api/config` returned HTTP 200 with `modelProvider=openrouter`, `modelName=openai/gpt-5.6-luna`, `modelMode=live`, `modelEnabled=true`, and `providerMode=fixture`. This confirmed the configuration at that time; the legacy Planner and chat workflows were not covered by that check.

A separate **live OpenRouter probe passed on 2026-09-12**. Authenticated `GET /api/v1/key` succeeded. Exactly one `POST /api/v1/chat/completions`, using the existing `createModelClient` and `openai/gpt-5.6-luna`, returned a valid response to a small synthetic strict-JSON-Schema request. It used an output cap of 256 tokens, `store:false`, required parameter support, disabled provider fallbacks, and zero retries; reported usage was 86 prompt tokens and 40 completion tokens. No credential or response text was printed, and no task-provider writes occurred.

This proves authentication and the minimal structured transport only. It did not exercise the full Planner, save an application proposal, stream through live CopilotKit, or run the extension chat end to end. Those checks remain pending; the six runtime tests above use synthetic responses.

## Earlier fixture browser and visual verification

The built-in browser was used first to load the workspace and inspect its pairing UI. Playwright supplies repeatable full-page interaction and a persistent Chromium profile for the unpacked extension; the built-in browser does not load unpacked extensions.

The browser suite checks:

1. Confirm an editable contract; edit plan effort and dependencies; approve six tasks; inspect provider read-back; review and approve a missing video requirement; recapture exact evidence without another task; mark a local blocker; approve a recovery that defers optional work; reload; inspect retained activity/evidence; and check widths of 360, 390, 400, and 480 pixels without horizontal overflow.
2. Enter a private unsent capture and discard it, asserting that its marker never appears in a backend request.
3. Load the built MV3 extension in a temporary persistent Chromium profile; observe its real service worker; pair into trusted session storage; reload with the session retained; reject capture of the extension-owned workspace with a manual fallback; and clear an expired capture inbox.
4. Reject an initial proposal and verify no tasks exist; regenerate and approve it; verify that completion is disabled until all three required criteria receive explicit labeled fixture attestations; complete the mission; and reload the completed state.

The prior fixture browser run passed **4 of 4 tests in 13.4 seconds**, after restarting the backend with the source completed at that time. No browser test was skipped in that run. This historical result predates the OpenRouter update and is separate from the newer workspace-upgrade and execution browser results. The full mission test also asserts no page runtime exceptions. Screenshots and the concept comparison are described in [design review](design-review.md). Test traces are disabled because pairing is part of the test; credentials must not be recorded in trace artifacts.

The installed test browser on this machine is Chromium build 1243. Playwright 1.58.2 normally selects build 1208, which was unavailable locally, so the verification run uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to select the existing executable. On a fresh machine, install the browser matching the lockfile with `pnpm exec playwright install chromium` and leave that override unset.

The production build emits upstream `node-fetch` browser-externalization warnings and large-chunk warnings. These did not prevent the tested fixture UI or extension from loading. Actual live CopilotKit streaming still needs its own acceptance check; successful bundling does not establish that path. The host's nested pnpm wrapper also warns about legacy package settings; the same required override is present in `pnpm-workspace.yaml`, and the build succeeds.

## Regular Chrome verification and remaining native checks

An earlier session in the user's regular Chrome verified that Mission Control was installed as an unpacked extension, pinned to the toolbar, opened in the native side panel, and paired successfully. Saved fixture missions loaded in that panel. These installation and pairing results remain distinct from live model/provider acceptance.

At that earlier snapshot, connection to an existing Chrome tab worked, but the OpenRouter update had not received full application browser verification. The subsequent full-page execution checks above do not establish the following native capture and lifecycle checks:

| Check | Action | Expected result |
| --- | --- | --- |
| Selection menu | Select public text in the fixture requirements page; invoke each of the three Mission Control menu actions | Panel opens with the selected excerpt and correct intent; nothing is sent automatically |
| Page capture | Invoke the toolbar, then select Capture page in the panel | Readable main content appears in an editable preview; form values and private drafts from the privacy fixture are absent |
| Temporary access loss | Keep the panel open, navigate to an unrelated origin, then capture without invoking the toolbar again | Explain missing temporary access; require another toolbar invocation or manual text |
| Unsupported pages | Try an internal browser page or protected extension-store page | Explain the limitation and offer manual text; no permission escalation |
| Panel/service-worker lifecycle | Leave a preview, close/reopen the panel, then test expiry and worker suspension | Unexpired preview may be restored; expired preview is removed; accepted mission state is reloaded from the backend |

The earlier regular Chrome session established native panel opening. Automated browser tests do not click the OS selection context menu, and JSDOM selection tests do not prove Chrome's activeTab permission behavior.

## Historical integration boundaries

These bullets preserve the scope of the earlier planning-only snapshot. The current execution path and later authenticated checks supersede its automation, missing-key, and unverified-identity statements.

- **Fixture mode:** Complete local goal/contract → review/edit/approve → provider fixture read-back → accepted evidence → missing requirement → blocker/recovery → persistence → criterion verification loop. Fixture labels remain visible. Task execution itself is not automated.
- **Live Ambiguous adapter, at that snapshot:** Implemented against the retrieved official schema, with identity gating, one-task create/read/update smoke gating, field ownership, durable operations, read-back, conflict handling, and visible unknown outcomes. Transport tests used controlled responses; account identity and writes were then unverified. The admin key form was prepared, but credential creation awaited explicit approval for full `*` scope after automatic approval review rejected the earlier general confirmation; no key had been saved at that time. That credential/identity status is now obsolete: authenticated read-only identity and roster discovery subsequently passed. Native write acceptance is still pending.
- **CopilotKit/OpenRouter and direct OpenAI:** Real v2 provider, contextual hooks/tools, six controlled React components, human feedback, and authenticated runtime are implemented. Current tests verify transport selection and a synthetic stream through the actual runtime using mocked responses. The separate live probe verifies only the small OpenRouter structured request described above. Live CopilotKit streaming, frontend card tool calls, reconnect behavior, full Planner generation, and persisted model proposals remain unverified. Direct OpenAI is an explicit alternative and has no live acceptance result either.
- **Database:** Persistent embedded PostgreSQL is verified. Standard PostgreSQL migrations and a loopback Docker Compose service are supplied; that separate server configuration was not executed because the Docker daemon was unavailable.
- **Phase two:** Trigger.dev/Exa research is explicitly disabled. No worker SDK or local timer is presented as a completed durable workflow. Implement and verify it only after core live acceptance succeeds.

## Known limits and next acceptance

Configured Ambiguous credentials and expected identity have now passed authenticated read-only verification. Native write acceptance remains separate: verify authorized task creation/assignment, shared document persistence, provider read-back, human review, and the final deliverable in Ambiguous before claiming a completed live workspace mission. Separately verify an actual legacy CopilotKit stream and persisted planning proposal. Actual execution-model planning/drafting with fixture storage has passed; it does not establish those other flows. See [setup](setup.md) and [the execution acceptance scenario](mission-execution.md).

The scheduler has explicit effort/capacity assumptions and no working calendars. Semantic duplicate screening is conservative; possible duplicates require review. No conditional vendor write primitive was documented, leaving a read-to-write race that cannot be eliminated by a local ledger. Unknown writes without returned IDs require inspection. Live conversation history is bounded in process and is lost on server restart, while mission and approval state persists. The production extension is approximately 17 MB with source maps disabled; the CopilotKit bundle is relatively large, so a production release would need bundle and performance work.

This local build was not published, deployed, submitted to an event, or approved by the Chrome Web Store. It is a single-user local application, not a hosted multiuser service.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:browser
pnpm test:execution
```

Browser tests require the backend and frontend loopback ports. The Playwright configuration starts them if absent and refuses the fixture workflow against a live provider. It creates labeled fixture missions in the running local database, so their activity may remain available for inspection. See [demo](demo.md) for the fixed domain test clock and the running demo's illustrative dates.

## Historical workspace upgrade verification

That implementation stage passed 207 unit/integration tests across 21 files, typecheck, production build, and 6 browser tests in CI. The final bounded extraction adjustment also passed all 12 extraction tests. The frozen-lockfile installation passed. These historical results include the preserved OpenRouter transport changes; the current full suite total is 296 tests across 26 files.

That browser suite used the real unpacked MV3 extension in a persistent Chromium context, scoped fixture extraction, source changes, frozen requests, pause, and persistent-profile close/reopen. It verified artifact/routine persistence and layouts at 360–480 pixels. Native toolbar/context-menu side-panel gestures, permission dialogs, and full multiwindow/worker-suspension races still require manual checks. No authenticated provider operation or live model call was performed in that historical suite; the later authenticated reads and actual-model rehearsal are recorded above. Provider transport contract fixtures remain distinct from native write acceptance.

Remaining acceptance gaps include authorized live workspace proof, authenticated native automation node/connection schemas and approval enforcement, rich native Sheets/Slides editing, and image-to-model sharing. Live Assist collects only while its panel is mounted. Screenshot preview/crop/redaction is local. See the [capability matrix](ambiguous-capabilities.md), [native workflow mapping](native-workflow-mapping.md), and [Launch Review demo/manual checks](upgrade-demo.md) for precise supported paths and blockers.

On Linux ARM64, Chromium was verified using the official Playwright archive. The Node-based installer extraction stalled; extracting the downloaded archive with Python zipfile worked. Writable XDG config/cache directories were needed for Chromium Crashpad. These environment workarounds do not establish live-provider or native side-panel acceptance.
