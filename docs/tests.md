# Implementation and test report

Reviewed locally on **2026-09-12**. This is a working fixture MVP with a credential-gated live integration path. No live Ambiguous record or OpenAI model request was executed during this build.

## Executed checks

| Layer | Result | Evidence and scope |
| --- | --- | --- |
| TypeScript | Passed | Root `tsc --noEmit`, covering domain, server, extension, shared UI, workers stub, and tests |
| Domain | 52 tests passed | Dependency validation, owner/capacity scheduling, generated DAG invariants, unknown estimates, required criterion coverage and optional upgrades, approval hash/revision/expiry, evidence deduplication/redaction, safe recovery, and completion verification |
| Page capture | 6 tests passed | Actual capture function in JSDOM: main text/selection, private forms and drafts, hidden content, 20,000-character truncation, source sanitization, and inbox validation |
| Timezones | 5 tests passed | Displayed IANA zone conversion independent of host zone, fractional offsets, invalid dates, DST gaps, and readable recovery dates |
| Provider adapter | 14 tests passed | Mocked official API responses verify discovery/identity, returned-ID read-back, supported patches, timeouts, unknown outcomes, conflicts, recurrence restrictions, redacted errors, and durable fixture idempotency |
| Approval service/database | 15 tests passed | No write before approval, double approval, stale/hash/scope checks, partial writes, unknown-outcome reconciliation, human edit conflicts, local blocker preservation, observed provider status, closed lifecycle guards, duplicate evidence, criterion verification, and disk-backed database close/reopen |
| Authenticated HTTP API | 8 tests passed | Real loopback HTTP server: anonymous access, wrong code, exact origins, extension pairing, revised proposals, forged mappings/attestations, safe configuration, revocation, and closed-mission retry guard |
| Real CopilotKit runtime adapter | 2 tests passed | Actual installed v2 runtime serves agent discovery and handles an unknown agent through the Express parsed-body bridge; no model invocation |
| Structured model-result boundary | 13 tests passed | Strict parsed output, exact supporting excerpt, scoped IDs, optional-to-required upgrades, committed task coverage, preserved estimates/dependencies/blockers, covered and uncertain outcomes, and invalid-result rejection; no model invocation |
| Production build | Passed | Extension UI and service worker bundled; server TypeScript build passed; approximately 17 MB with no source maps |

The final complete Vitest run passed **115 tests across 8 files**. Tests use separate ephemeral databases and provider fixtures. The persistence test closes and reopens an actual disk-backed PGlite PostgreSQL database, then confirms the same tasks, evidence, and provider IDs.

## Browser and visual verification

The built-in browser was used first to load the workspace and inspect its pairing UI. Playwright supplies repeatable full-page interaction and a persistent Chromium profile for the unpacked extension; the built-in browser does not load unpacked extensions.

The browser suite checks:

1. Confirm an editable contract; edit plan effort and dependencies; approve six tasks; inspect provider read-back; review and approve a missing video requirement; recapture exact evidence without another task; mark a local blocker; approve a recovery that defers optional work; reload; inspect retained activity/evidence; and check widths of 360, 390, 400, and 480 pixels without horizontal overflow.
2. Enter a private unsent capture and discard it, asserting that its marker never appears in a backend request.
3. Load the built MV3 extension in a temporary persistent Chromium profile; observe its real service worker; pair into trusted session storage; reload with the session retained; reject capture of the extension-owned workspace with a manual fallback; and clear an expired capture inbox.
4. Reject an initial proposal and verify no tasks exist; regenerate and approve it; verify that completion is disabled until all three required criteria receive explicit labeled fixture attestations; complete the mission; and reload the completed state.

The final browser run passed **4 of 4 tests in 13.4 seconds**, after restarting the backend with the finished source. No browser test was skipped. The full mission test also asserts no page runtime exceptions. Screenshots and the concept comparison are described in [design review](design-review.md). Test traces are disabled because pairing is part of the test; credentials must not be recorded in trace artifacts.

The installed test browser on this machine is Chromium build 1243. Playwright 1.58.2 normally selects build 1208, which was unavailable locally, so the verification run uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to select the existing executable. On a fresh machine, install the browser matching the lockfile with `pnpm exec playwright install chromium` and leave that override unset.

The production build emits upstream `node-fetch` browser-externalization warnings and large-chunk warnings. These did not prevent the tested fixture UI or extension from loading. Actual live CopilotKit streaming still needs its own acceptance check; successful bundling does not establish that path. The host's nested pnpm wrapper also warns about legacy package settings; the same required override is present in `pnpm-workspace.yaml`, and the build succeeds.

## Native Chrome checks still required

These paths are implemented but have **not** been established by the automated full-page or headless extension checks. Run them manually in Chrome after loading `apps/extension/dist`:

| Check | Action | Expected result |
| --- | --- | --- |
| Toolbar and side panel | Pin the icon, visit an ordinary page, then click it | Native side panel opens from that user gesture |
| Selection menu | Select public text in the fixture requirements page; invoke each of the three Mission Control menu actions | Panel opens with the selected excerpt and correct intent; nothing is sent automatically |
| Page capture | Invoke the toolbar, then select Capture page in the panel | Readable main content appears in an editable preview; form values and private drafts from the privacy fixture are absent |
| Temporary access loss | Keep the panel open, navigate to an unrelated origin, then capture without invoking the toolbar again | Explain missing temporary access; require another toolbar invocation or manual text |
| Unsupported pages | Try an internal browser page or protected extension-store page | Explain the limitation and offer manual text; no permission escalation |
| Panel/service-worker lifecycle | Leave a preview, close/reopen the panel, then test expiry and worker suspension | Unexpired preview may be restored; expired preview is removed; accepted mission state is reloaded from the backend |

Browser tests do not click Chrome's native toolbar or OS context menu. JSDOM selection tests do not prove Chrome's activeTab permission behavior.

## Implemented integration boundaries

- **Fixture mode:** Complete local goal/contract → review/edit/approve → provider fixture read-back → accepted evidence → missing requirement → blocker/recovery → persistence → criterion verification loop. Fixture labels remain visible. Task execution itself is not automated.
- **Live Ambiguous adapter:** Implemented against the retrieved official schema, with identity gating, one-task create/read/update smoke gating, field ownership, durable operations, read-back, conflict handling, and visible unknown outcomes. Transport tests use controlled responses; actual account access remains unverified.
- **CopilotKit/OpenAI:** Real v2 provider, contextual hooks/tools, six controlled React components, human feedback, and authenticated runtime are implemented. Runtime import/discovery tests passed. Account-backed streaming, frontend card tool calls, reconnect behavior during a live stream, and OpenAI structured outputs still require credentials and live acceptance.
- **Database:** Persistent embedded PostgreSQL is verified. Standard PostgreSQL migrations and a loopback Docker Compose service are supplied; that separate server configuration was not executed because the Docker daemon was unavailable.
- **Phase two:** Trigger.dev/Exa research is explicitly disabled. No worker SDK or local timer is presented as a completed durable workflow. Implement and verify it only after core live acceptance succeeds.

## Known limits and next acceptance

Configure the keys and expected Ambiguous identity described in [setup](setup.md). Complete exactly one approved live task create, retrieve its returned ID, approve a supported update, and retrieve it again before expanding to a full live plan. Separately verify an actual OpenAI/CopilotKit stream and a persisted proposal. Missing credentials are not reported as a successful integration.

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
```

Browser tests require the backend and frontend loopback ports. The Playwright configuration starts them if absent and refuses the fixture workflow against a live provider. It creates labeled fixture missions in the running local database, so their activity may remain available for inspection. See [demo](demo.md) for the fixed domain test clock and the running demo's illustrative dates.
