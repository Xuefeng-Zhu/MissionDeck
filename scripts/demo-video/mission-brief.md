# MissionDeck: requirements and demo source brief

This brief supplies product facts and the limited event context checked by the coordinator for drafting. The human reviewer must confirm any additional event-specific requirements using official source material.

## Confirmed event context supplied by the coordinator

- The event's agent concept belongs in existing tools, channels, and documents where people already work.
- The requested submission demonstration is a working demo in a two-minute video.
- This brief was prepared on September 12, 2026. That is the preparation date, not a claim about a submission deadline.

No other official rule, eligibility requirement, judging criterion, prize, or deadline was supplied. Keep those unknown rather than inventing them.

## Product mission

A user states a mission. MissionDeck breaks the work into tasks in Ambiguous.ai, assigns specific workspace humans or agents, starts supported agent work when dependencies are ready, and keeps the resulting documents in Ambiguous. The intended experience removes repeated copy-and-paste handoffs between a plan, an agent conversation, and a shared artifact library.

## Implemented execution scope

- Mission start records a bounded authorization and creates an idempotent execution request.
- A configured model creates a structured task plan with deliverables, dependencies, and human or agent assignment.
- The native adapter discovers workspace identities and writes/read-backs actual Ambiguous task ownership, dependencies, descriptions, and document content.
- The agent work is performed by MissionDeck's server-side text drafting worker using the selected model provider. A native Ambiguous task assignment does not dispatch an independent Ambiguous agent process.
- Supported agent work is text drafting and synthesis from supplied mission context and persisted prerequisite documents. The worker cannot independently browse, conduct external research, run code, build software, send messages, publish, or create native slide decks. Such work needs a human or a separately integrated capability.
- Agent work waits for prerequisite tasks and consumes saved outputs from their dependency chain. A required human review must contain actual feedback; a done label alone does not constitute review content.
- The backend continues without an open side panel, tracks bounded run attempts, uses worker leases, and retains generated outputs for recovery. Uncertain workspace writes require reconciliation rather than blind duplication.
- Pause, resume, cancellation, retry, and reassignment are available. A paused mission remains paused when its assignment changes.
- Mission documents include the brief/task index, draft, human review, final text deliverable, execution summary, and an outcome verification statement. Documents are shared with the mission's selected participants and read back before delivery is reported.
- Completion requires a human's explicit outcome-verification statement. A successful model call alone is not proof that the mission succeeded.

## Proposed four-slide story

1. The user's mission and the coordination problem: show the actual mission being entered.
2. One plan with named humans and agents: show the native tasks and the first agent working.
3. Human judgment releases the next step: show the saved draft, real review feedback, and the dependent final task.
4. A shared result: show the final text storyboard and its saved Ambiguous documents, with a short honest statement of the present text-only execution scope.

The runtime is two minutes, matching the confirmed demo-video context above. Four slides are the user's chosen production format for this demo, not an asserted event rule. This mission produces the text storyboard; native slide creation and video recording happen as separate downstream work.

## Evidence boundaries and unknowns

- Isolated fixture tests and browser rehearsals demonstrate local workflow behavior. They do not by themselves prove native writes to Ambiguous or real human acceptance.
- A live-model/fixture-workspace rehearsal demonstrates actual model calls but does not establish native Ambiguous task or document delivery.
- This mission is intended to use live workspace and live model modes. The final narrative may claim native completion only when its actual task IDs, document IDs, assignees, read-back records, and the recorded run support that claim.
- Beyond the confirmed context at the top of this brief, no official hackathon eligibility, deadline, required technology, judging criteria, prize, submission URL, or video-hosting requirement has been supplied. Do not invent them. Incorporate additional official rules only when the human supplies the exact source text or verifies them in review.
- Do not claim the product is a general-purpose coding agent, autonomous web researcher, native Ambiguous agent dispatcher, or a native presentation generator.

## Repository sources

- `docs/mission-execution.md`: product contract, bounded scope, acceptance scenario, artifact ownership, and verification requirements.
- `apps/server/src/execution-service.ts`: orchestration, assignments, dependency release, recovery, and mission verification.
- `apps/server/src/execution-provider.ts`: native workspace adapter and explicit fixture adapter.
- `apps/server/src/execution-runner.ts`: live-model structured plans and bounded text drafting/synthesis.
- `apps/server/src/execution-router.ts`: mission start, status, review, controls, and reconciliation API.

For the storyboard, keep the on-screen sequence practical and the narration factual. Identify missing proof explicitly instead of filling it with invented outcomes.
