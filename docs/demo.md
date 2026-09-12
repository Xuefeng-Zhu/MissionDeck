# Two-minute demonstration

This script demonstrates Mission Control's implemented workflow using clearly labeled fixtures. It is not evidence that a live integration passed. For a live demonstration, complete the one-task Ambiguous create/read/update acceptance gate in [integrations](integrations.md) first, then use the real returned IDs and outcomes.

## Preparation

Run the app, build/load the unpacked extension, and pair the extension session using [setup](setup.md). Keep `PROVIDER_MODE=fixture` and `MODEL_MODE=fixture` for the reproducible no-credential run. The running demo sets its illustrative deadline five hours after creation and uses the real clock for approval expiry. Domain tests and demo factories use the explicit fixed clock `DEMO_NOW=2026-09-12T16:00:00.000Z`; setting that variable does not freeze the running server. These are not dates of an actual hackathon.

Open the labeled demo requirements page served by the local app. Keep the side panel at approximately 400 pixels wide. The same interface also opens as an extension-owned full-page workspace for larger review.

The default plan contains six suggested tasks: implementation, project description, demo verification, package assembly, final checklist, and optional polish. One human owner and two concurrent agent slots are scheduling assumptions. An agent executor is proposed capacity, not evidence that an autonomous worker is performing the task.

## 0:00–0:25 — Outcome and approval

Say: “The browser gives us context. The mission keeps the outcome, deadline, and success criteria explicit.”

Choose **Start demo mission**, review the exact deadline/timezone and contract, and confirm it. Show the proposed tasks and dependencies. Briefly edit an effort estimate in the plan review so the audience sees that the plan is reviewable. Click **Approve and create tasks**. Show the resulting fixture IDs and synchronization timestamps. In a previously validated live run, show actual Ambiguous IDs instead.

## 0:25–0:50 — New evidence changes the plan

Select the requirement: “A two-minute demo video is required.” Use **Add to mission** in the selection context menu. Review the excerpt, its source, and the selected destination mission before choosing **Send to Mission Control**.

Show the missing-requirement card: an added required criterion, a video task, the suggested 80-minute estimate, its dependency on demo verification, and the recalculated schedule. Approve the displayed change and show provider read-back. Capture the same excerpt again: the app should explain that it already exists, with no additional task.

## 0:50–1:20 — Blocker and recovery

Explicitly mark the implementation step blocked with a labeled reason such as “Simulated demo blocker: the test environment is unavailable; the fix duration is unknown.” Show how dependent required work is affected and the ETA becomes qualified or unknown.

Choose **Review recovery options**. Show at most two diffs. The first can defer optional polish and start independent drafting. The blocker still exists; do not say the mission is back on track. The other may propose a local deadline extension, while stating that it does not change an actual event deadline.

Approve the recovery option whose tradeoffs you want to demonstrate. Show any supported provider update read-back and the locally owned scheduling change. Do not silently mark the blocker resolved.

## 1:20–1:45 — Persistence and truthfulness

Close and reopen the side panel. The mission, accepted evidence, pending/approved proposal state, and activity history reload from the server. Use **Sync now** to retrieve the same provider records. The result should retain the same IDs, not create replacements.

Say: “Every external change is traceable to the exact approval. A timeout has an unknown outcome until we can reconcile it.” If demonstrating a simulated failure, label it as a test scenario rather than a live vendor outage.

## 1:45–2:00 — Verification

Open **Verify completion**. Explain the difference between reported task completion and a verified required criterion. Show the required criterion count and its evidence/attestation controls. Leave missing real evidence unverified. Complete the mission only when the required outcomes have genuinely been checked or explicitly attested with an honest statement.

Close with the next actual action shown in the plan. Do not publish, submit to an event, or claim live integrations succeeded as part of this script.

## Reproducibility and limitations

The app computes all schedule labels from task effort, capacity, dependencies, and the current server time. Domain tests supply a fixed clock for reproducible projections. The demonstration must use the numbers displayed by that calculation. Changing an estimate can change the result; no “back on track” label is hardcoded.

Fixture mode disables the actual CopilotKit model conversation, while retaining the same persisted review cards and approval endpoints. Live CopilotKit streaming, real model proposals, and external create/read/update need their separate configured acceptance checks. Native toolbar opening, selection capture, temporary access loss, unsupported-page fallback, and side-panel lifecycle require the extension checks listed in the test report.
