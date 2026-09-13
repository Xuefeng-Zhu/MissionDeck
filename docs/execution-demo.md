# Mission execution demo

## Operator path

Confirm the workspace and model modes before starting. For a repeatable simulation use `PROVIDER_MODE=fixture` and `MODEL_MODE=fixture`; for real generated text without native workspace writes, use fixture storage with a live model. See [setup](setup.md) for local startup and pairing.

| Provider mode / model mode | What happens | Verified on 2026-09-12 |
| --- | --- | --- |
| `fixture` / `fixture` | Real server orchestration and local fixture records; deterministic simulated model output | Browser flow and automated regression passed |
| `fixture` / `live` | Actual model planning and drafting; tasks and documents remain in local fixture storage | A full rehearsal completed three tasks and six saved documents |
| `live` / `live` | Actual model work and native Ambiguous task/document writes | Authenticated identity and roster reads passed; native write rehearsal remains pending |

1. Open the running Mission Control app and pair the browser session in **Settings** if needed.
2. Choose **New mission**, then **Try a sample mission**. This fills a launch-brief mission and clearly fictional facts about a product called Harbor.
3. Review the **Human reviewer** and **Working agent**. The sample selects an available identity only when that field was empty and sets limits of **3 tasks and 4 agent runs**. These are sample-specific limits; an untouched custom mission form uses its own displayed limits.
4. Choose **Start mission**. The **Execute** view shows the tasks, named assignees, dependencies, and verified provider records. Ready drafting work starts automatically.
5. Open the saved draft. When the human review task is ready, enter feedback such as: “Keep the small-team audience. Emphasize named ownership and the shared document library. Do not add pricing or launch dates.” Choose **Save review and continue**.
6. Watch the dependent final task proceed, then open its saved artifact. Enter an **Outcome verification** statement describing how the final brief meets the mission and choose **Verify and complete mission**.
7. Reload the page. The mission should reopen on **Execute** with its saved progress and artifacts.

Optional controls: pause and resume work; reassign a pending task to a discovered human or agent; or cancel remaining work. Reassignment explicitly shares saved mission artifacts with the selected participant. Existing participant access remains. Inspect uncertain provider results with **Reconcile saved record** using an actual existing provider ID; do not create a replacement record to bypass uncertainty.

## What to say during the demo

“I state the mission once. MissionDeck breaks it into assigned tasks, starts ready work, waits for human review, and retains the resulting documents with the mission. Completion requires verifying the outcome.”

The execution board is authoritative for progress. The managed-mission header intentionally omits the older planning health and criterion counts and displays **No deadline set**.

## Factual limits

- The first execution scope is text drafting and synthesis from supplied context. Links are not fetched automatically, and arbitrary coding, browsing, deployment, or outbound communication is outside this runner.
- A MissionDeck server drafting worker runs model calls for the selected agent identity. This does not launch a native Codex, Hermes, or Ambiguous agent process.
- A fixture **workspace** label means simulated assignments and stored records. A fixture **model** label means deterministic generated output. A live model can run while workspace storage remains in fixture mode.
- Saved artifacts expose provider IDs returned by the configured adapter and verified content. Native task and document routes were separately verified against Ambiguous's public application bundle: `/tasks?task=<uuid>` and `/docs/<uuid>`, both under `https://app.ambiguous.ai`. The adapter uses these validated formats for live records; fixture records have no native links. This route verification does not establish native artifact delivery. See [API discovery](execution-api-discovery.md).
- Agent-run limits bound the number of attempts, not monetary charges. Running work may finish after a pause; cancelling retains already-saved records.

## Verification recorded on 2026-09-12

The latest complete local suite passed **296 tests across 26 files**. The production frontend and extension-worker builds, TypeScript checking, and diff checks passed. A route-mocked Playwright run at 1440×1000 and 390×900 verified sample prefill, mission start, recovery after a simulated lost response using the identical request ID and payload, pause/resume, pending-task reassignment, uncertain-record reconciliation, human review, artifact viewing, outcome verification, and reopening **Execute** after reload.

The checked pages had the expected title and meaningful content, no framework error overlay, no unexpected application errors, and no horizontal overflow. Desktop and mobile screenshots were inspected. Every backend request in this UI run was intercepted; these results establish the rendered interaction flow only.

### Real fixture-server integration

A separate Chrome run completed the same sample flow against the actual local server and fixture storage on port 4321. Browser API requests were forwarded to that server rather than replaced with invented responses. The persisted result contained three completed tasks, two drafting-worker runs, and six verified artifacts: the brief, draft, human review, final deliverable, execution summary, and outcome verification. All recorded provider operations finished in `done`. Reload preserved the saved mission, and desktop/mobile checks reported no application errors or horizontal overflow.

Session evidence is available locally: [result JSON](/private/tmp/missiondeck-demo-real-result.json), [completed desktop](/private/tmp/missiondeck-demo-real-completed-desktop.png), and [completed mobile](/private/tmp/missiondeck-demo-real-completed-mobile.png). These files are temporary local evidence. This run verifies the real orchestration and storage code with simulated providers; it does not prove live model work or native Ambiguous delivery.

### Live-model rehearsal with fixture storage

A separate rehearsal used actual model planning and drafting with `PROVIDER_MODE=fixture` and `MODEL_MODE=live`. It completed three tasks, including the human-review handoff, with two actual drafting-worker runs and six persisted documents. Review feedback and the final verification statement were synthetic test inputs, not the user's acceptance of a real deliverable. Every provider operation was verified. The final brief incorporated the saved review feedback and remained grounded in the fictional Harbor notes. Inspect the [result JSON](/private/tmp/missiondeck-live-model-result.json) and [generated final brief](/private/tmp/missiondeck-live-model-final.md).

The first planning attempt failed safely before workspace writes. An explicit resume initiated the successful planning attempt; there was no automatic retry of that failed model request. The reported two agent runs count the drafting tasks, not the planning requests. A missing transitive-dependency artifact issue found during rehearsal was fixed and covered by a regression, so final tasks receive verified documents from the full dependency chain.

Authenticated read-only native discovery also verified the configured Ambiguous user/workspace and the complete roster of one human and two agent identities. The adapter successfully read an existing native task, including its fingerprint and native URL; that task had no custom status or recurrence. No native task/document writes have been performed in this execution rehearsal, and native create/update behavior remains unverified. Native Codex or Hermes processes were not launched; the bounded server text runner performed the model work.

### Repeat the isolated browser regression

```sh
pnpm test:execution
```

The dedicated [Playwright configuration](../playwright.execution.config.ts) runs only [the execution regression](../tests/browser/execution.spec.ts). It starts a fixture backend on port 4321 with a unique temporary data directory, or reuses an existing local server after checking its modes. The browser uses the local frontend on port 5173. Only its backend API traffic is forwarded to port 4321; the normal backend on port 4318 receives no test API requests. The test refuses to proceed unless both provider and model modes are `fixture`, and checks again before each write.

The test pairs with the fixture code `execution-demo-fixture-code`, creates a fresh mission, exercises sample prefill and human review through the UI, verifies dependency gating and all six saved documents, completes the outcome review, then reloads and checks the mobile layout. Screenshots and machine-readable results go under a unique `/private/tmp/missiondeck-execution-browser-*` directory on macOS, not into the repository. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when using a locally installed Chrome instead of Playwright's browser.

The latest repository regression passed on 2026-09-12 using local Chrome and a fresh fixture backend: **1 test passed in 12.9 seconds**, with three completed tasks, two worker runs, six unique saved documents, and every operation in `done`. It exercised the current sample limits of 3 tasks and 4 agent runs. Desktop and mobile screenshots were inspected; the managed header showed no stale health or criterion counts. The main server was restarted with the latest source in fixture-storage/live-model mode, its health check passed, and the app was opened at `http://127.0.0.1:5173`.
