# Mission execution product requirement

## Intended outcome

The user states a mission. MissionDeck breaks it into actionable tasks in **Ambiguous.ai**, assigns each task to a specific human or agent, starts eligible agent work, and keeps the resulting artifacts in Ambiguous. MissionDeck is the coordination interface; Ambiguous is the shared workspace for the work and its outputs.

This is the target product contract. The first implemented execution scope covers text drafting and synthesis from supplied context, human review, and shared Ambiguous documents. The full loop passes isolated fixture-server and browser verification; native write acceptance is tracked separately. General coding, browsing, and other external work remains human-assigned until a suitable runner is integrated.

## Core user flow

1. **State and start a mission.** The user describes the desired outcome, with any deadline, constraints, and available context. Starting the mission authorizes work within the configured capabilities and budget. Ask for missing information only when it prevents useful progress; record non-blocking assumptions and continue independent work.
2. **Break down the work in Ambiguous.** Produce tasks with an expected deliverable, completion criteria, dependencies, and a real assignee. Persist the mission brief and task index in Ambiguous so the work is understandable from that workspace alone. Show the plan and allow the user to adjust it.
3. **Assign a human or agent.** Resolve people and agents against the connected workspace and execution capabilities. Use agents for supported work they can actually perform. Assign judgment, access, or manual work to a named human. A generic “Agent” label does not establish an assignment. If no suitable assignee exists, report the gap instead of inventing one.
4. **Start ready agent tasks automatically.** Once the task and its assignment are confirmed in Ambiguous, start work when dependencies are satisfied and capacity is available. The user should not need to copy tasks to another chat, click Run for every task, or approve each ordinary output within the mission's authorized scope.
5. **Collaborate through Ambiguous.** Human tasks remain visible with their expected inputs and outputs. Agent progress, questions, blockers, and review requests are linked to the relevant task. Human updates made in Ambiguous are reconciled into MissionDeck and can unblock dependent agent work.
6. **Keep artifacts in Ambiguous.** Save working drafts, final deliverables, supporting evidence, and concise execution summaries in Ambiguous, linked to the mission and originating task. Dependent agents consume these persisted outputs. Verify saved content before reporting successful delivery.
7. **Finish against the mission outcome.** Assess task deliverables against their completion criteria and assess the mission against its required outcomes. Ask for human review where the mission requires it. A completed model call or a task marked done alone does not establish mission success.

The normal execution path proceeds within the authority granted at mission start. Expanding scope, credentials, permissions, or budgets requires a separate decision. Sending messages, publishing, and other consequential actions follow their specific authorization requirements; internal drafting should continue when it is independent of that decision.

## Ownership and persistence

| Information | Required home |
| --- | --- |
| Mission brief, task index, deliverables, and completion requirements | Ambiguous records, using a linked document for mission metadata where needed |
| Task ownership and work status | Real Ambiguous task records and verified human/agent identities |
| Drafts, final artifacts, accepted evidence, and execution summaries | Appropriate Ambiguous documents or supported artifact storage, linked to task and mission |
| Runtime leases, dispatch attempts, reconciliation, authorization records, and cached views | Durable server storage referencing the Ambiguous records |
| Unaccepted browser context and secrets | Existing temporary-context and credential boundaries; not automatically published as artifacts |

“All artifacts in Ambiguous” means the actual deliverable is retained there. A local database row, a transient chat answer, a fixture ID, or a link to an otherwise unsaved file is insufficient. For an unsupported artifact format, report the storage limitation and preserve the output for recovery without claiming delivery. Task and mission views must expose real provider IDs and verified links when the provider supplies them.

## Execution behavior

- Track assignment, provider synchronization, agent run state, and deliverable verification separately. Task creation is not proof that an agent has started.
- Persist dispatch intent and actual run identity. Prevent duplicate dispatch for the same authorized task version, and reconcile uncertain outcomes before retrying.
- Enforce dependencies in execution, not only in schedule estimates. A dependent task receives the verified output references it needs.
- Continue approved backend work when the side panel closes. Recover safely after server interruption without losing artifacts or inventing a successful run.
- Support mission pause, task reassignment, failure reporting, and cancellation with an honest account of work already performed. A reassigned or superseded task version must not start under an old assignment.
- Use verified Ambiguous native execution capabilities where they satisfy the runner contract. Exact identity, assignment, dispatch, status, and artifact APIs must be discovered before choosing or enabling a runner. Public endpoint names alone do not establish these capabilities.

## Current implementation and gaps

| Requirement | Current repository behavior | Required change |
| --- | --- | --- |
| Mission breakdown | Structured bounded plans, validation, idempotent mission start, persisted execution scope | Expand runner capabilities after the first demo scope |
| Tasks in Ambiguous | Dedicated execution adapter writes task ownership, dependencies, and mission linkage with read-back | Connected write rehearsal; native APIs do not offer general conditional updates |
| Human/agent assignment | Discovered workspace identities, verified native assignments, explicit reassignment | Validate the live write path; assignment does not launch an external native agent process |
| Agents start work | Durable server drafting worker, per-mission leases, run budgets, dependency gates, restart handling | Add execution types beyond provided-context text work |
| All artifacts in Ambiguous | Mission brief, drafts, human review, final deliverable, execution summary, and outcome verification are native documents shared with selected participants | Additional artifact formats and native live acceptance |
| Human collaboration unblocks agents | Server polls ready human tasks; changed description plus done becomes a saved review and releases dependent work | Event-driven updates and larger workspace throughput |

Implementation references: [execution types](../packages/domain/src/execution.ts), [durable coordinator](../apps/server/src/execution-service.ts), [workspace adapter](../apps/server/src/execution-provider.ts), [bounded runner](../apps/server/src/execution-runner.ts), [HTTP routes](../apps/server/src/execution-router.ts), and [native API discovery](execution-api-discovery.md). The older [research worker](../packages/workers/src/index.ts) remains disabled and is separate from the new drafting runner.

## First end-to-end acceptance scenario

Mission: **“Prepare a launch brief from these sources, have me review the positioning, then produce a final brief.”**

1. MissionDeck creates the mission brief and three real Ambiguous tasks: an agent drafts positioning, the user reviews it, and an agent produces the final brief after the review.
2. All three tasks show their real assignees in Ambiguous. The first agent task starts automatically; the final task waits for the human review.
3. The first agent saves its draft and source evidence in Ambiguous and links them to the drafting task. The user can find and review them directly there.
4. The user completes the review in Ambiguous. MissionDeck observes the update, verifies the required review result, and automatically starts the final agent task with the saved draft and review context.
5. The final brief and execution summary are saved in Ambiguous and linked to their task and mission. Mission completion reflects verified required outputs.
6. Closing the panel or restarting the backend during the scenario preserves progress. Replaying an event or resuming after a timeout does not duplicate tasks, agent runs, or artifacts; uncertain outcomes remain visible until reconciled.

Record native task, assignee, run, and artifact IDs plus read-back evidence for this test. Fixture success, contract tests, and documentation updates are useful intermediate checks; they do not satisfy this live acceptance scenario.
