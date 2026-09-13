# Mission Control — Agents, Everywhere submission packet

Prepared September 12, 2026. Entry remains a draft; no final entry or social post has been published. At the owner's subsequent request, the GitHub repository was made public and anonymous access was verified.

Follow-up: the project name, description, four sponsor/tool selections, other technologies, and GitHub link were filled in the AI Tinkerers form and saved with **Save Draft**. The portal confirmed **Draft Saved - Incomplete: 3 of 5 required items**. Team contributions were subsequently filled using the owner's confirmation: Lingyi handled brainstorming and project management; Xuefeng is building the project. The social-post URL is still missing. Video and prior-work fields remain blank. **Submit Entry was not clicked.**

**Product:** Mission Control. **Repository:** MissionDeck. **Portal team:** MillieMoon.

**Entry page:** https://seattle.aitinkerers.org/hackathons/h_GfcjwcUkasM/entries

**Deadline shown by the portal:** September 12, 2026, 4:30 PM PDT (23:30 UTC). Requirements and form were inspected live on September 12.

## Project Name — ready to paste

Mission Control

## One-line pitch

Turn browser context into a reviewable plan, with clear outcomes, explicit approvals, and a record of what actually happened.

This pitch is supporting copy, not a separate field in the inspected form.

## Project Description — ready to paste

### The problem

Getting a project across the finish line means piecing together requirements, issues, feedback, and deadlines scattered across browser tabs. Useful context changes while you work. A copied excerpt can become a forgotten requirement; a completed task can still leave the actual outcome unmet.

### What we built

Mission Control is a Chrome side-panel workspace that connects the page you are reading to the outcome you are trying to achieve. Start with a mission, an exact deadline, and clear success criteria. Review the proposed tasks, dependencies, and effort estimates. Edit the plan, then approve the exact changes you want to make.

As new information appears, capture a selected excerpt or choose specific browser sources. Review what will be shared and save useful excerpts as evidence. The planning flow can propose a missing requirement and show how it affects the work. When something is blocked, review recovery options and their tradeoffs. Completion is checked against required outcomes, separately from task status.

The browser is central to this interaction: the source, its provenance, and the mission remain together beside the work. Selected sources and opt-in Live Assist support changing context without collecting every tab. Private forms and drafts are excluded from extraction, and model sharing has a separate consent boundary.

### Engineering and AI

The application uses React, TypeScript, Vite, and Chrome Manifest V3, with an authenticated Express backend and persistent PGlite/PostgreSQL storage. CopilotKit v2 supplies contextual conversation, frontend tools, and controlled review components. Structured planning and evidence assessment support OpenRouter, with direct OpenAI as an explicit alternative. Model results pass schema and domain validation before they become proposals.

The backend records approvals, pending operations, and provider outcomes. Task changes require approval and read-back; ambiguous outcomes remain visible for reconciliation. The workspace upgrade also provides artifact-plan review and versioned routine previews. Codex helped implement and test that upgrade, followed by local review and verification.

### Prototype status

The reproducible demo uses clearly labeled fixture planning and task/workspace providers. All 207 distinct unit/integration tests, TypeScript checking, and both extension builds passed locally; six browser tests were previously reported passing in the remote build environment. A minimal live OpenRouter structured request also passed. Full live Planner/CopilotKit workflows and native Ambiguous writes remain unverified. Native routine activation is blocked, and the app runs locally rather than as a hosted service.

Mission Control makes the next proposed action inspectable—and keeps the record of what happened tied to the outcome.

## Products & Tools Used — recommended selections

The form asks which products were used or particularly helpful; these selections do not imply every live integration has passed.

| Form option | Selection | Specific use |
| --- | --- | --- |
| OpenAI | Select | Codex for implementation/testing; OpenAI SDK and explicit direct-provider support. Minimal OpenRouter probe used an OpenAI model. |
| CopilotKit | Select | v2 context, frontend tools, controlled review components, human feedback, authenticated runtime. |
| OpenRouter | Select | Configurable live planner/chat transport; one small credential-backed structured request passed. |
| Ambiguous AI | Select | Implemented task/workspace adapters and schema-based capability mapping; fixture/mocked verification, no live account-write acceptance yet. |
| AI Tinkerers | Leave for team confirmation | Event participation is known; the product/tool checkbox is not needed to satisfy a minimum selection count. |
| Exa, Trigger.dev | Leave unselected | Future research workflow is disabled and unimplemented. |
| Auth0, Mozilla.ai | Leave unselected | No implemented use found. |

**Other Products — ready to paste:**

TypeScript, React 19, Chrome Extensions Manifest V3 and Side Panel API, Vite, Node.js, Express 5, Zod, PGlite/PostgreSQL, Vitest, Playwright, GitHub.

## Team Contributions — confirmed by the owner

The refreshed signed-in form now lists the following two people. Their contributions must be accurate; do not assign work based only on team membership. Alyssa Kong, visible during initial preparation, is no longer listed in the current form.

| Team member | Confirmed contribution copy |
| --- | --- |
| Xuefeng Zhu (Lead) | Responsible for building Mission Control, including the Chrome extension, backend, and integrations with CopilotKit, OpenRouter, and the Ambiguous API, using Codex for development assistance. |
| Lingyi Kong (Member) | Contributed project brainstorming and project management. |

## Prior Work — confirmation needed

The [official handbook](https://seattle.aitinkerers.org/hackathons/h_GfcjwcUkasM/handbook) requires the project and core functionality to be a new build during the official hackathon period. Existing libraries/templates/building blocks are allowed; extending a pre-existing project does not satisfy that rule.

Repository history contains an initial implementation commit at September 12, 12:55 PM PDT and an upgrade commit at 2:30 PM PDT. Commit timestamps do not prove when implementation began. Confirm the actual build timeline and identify any earlier work before making an eligibility statement.

**Conditional wording — use only after team confirmation:**

Mission Control's core functionality was created during this hackathon. We used existing open-source libraries and consulted the CopilotKit Agents Everywhere starter and sponsor documentation. The mission model, browser-context workflow, review/approval logic, provider adapters, and application interface were built for this project during the event.

If that is inaccurate, replace it with the actual prior work and ask the organizers about eligibility. Do not use the conditional paragraph as an attestation without confirmation.

## Additional Links

| Label | URL / status |
| --- | --- |
| GitHub source and local setup | https://github.com/Xuefeng-Zhu/MissionDeck — **PUBLIC**, verified through an unauthenticated GitHub API request on September 12 after the owner authorized the visibility change. |
| Demo video | TODO: Two-minute YouTube (Unlisted/Public) or shareable Loom URL. |
| Public demo website | None. Use the repository's local Chrome-extension setup; do not enter a localhost URL as a public demo. |
| Public social post | TODO: Publish an approved post and paste its actual permalink. Copy is in `docs/submission-social.md`. |

The owner authorized the repository visibility change. Both remote branches and their two reachable commits received a bounded disclosure check; credential-pattern findings were synthetic tests. No new files or commits were pushed. Keep local environment files, databases, and machine-specific handoffs out of release assets. Social/video publication still needs separate authorization.

## Official requirements and form differences

Sources: [handbook](https://seattle.aitinkerers.org/hackathons/h_GfcjwcUkasM/handbook), [signed-in entry form and judging dialog](https://seattle.aitinkerers.org/hackathons/h_GfcjwcUkasM/entries).

| Item | Inspected form | Handbook / preparation decision |
| --- | --- | --- |
| Project name | Required; maximum 100 characters | Prepared above. |
| Description | Required; at least 25 words; Markdown/plain text accepted | Prepared above. |
| Products/tools | Required | Evidence-based selections above. |
| Team contributions | Required for Xuefeng and Lingyi in the refreshed form | Owner-confirmed contributions entered. |
| Public social post | Required; at least one URL | Draft prepared separately; posting and URL still needed. |
| Video | Labeled optional; two-minute limit, YouTube/Loom sharing instructions | Handbook says every team must provide a two-minute demonstration video. Include one. |
| GitHub | Additional Links section labeled optional | Handbook requires a public GitHub repository. Public visibility and anonymous access are now verified. |
| Prior work | If applicable | Confirm new-build eligibility and disclose any earlier work. |

The form requests all these social tags: `@AITinkerers @OpenAI @CopilotKit @openrouter @exaailabs @auth0 @ambiguousio @triggerdotdev @mozillaAI @googlecloud`, plus `#AgentsEverywhere`. For LinkedIn it gives the corresponding company names. These are event acknowledgments, not claims that all tools were integrated.

Judges score four criteria from 1–5: Core Requirements & Functionality; Innovation & Theme Alignment; Technical Execution & Integration; Usefulness & Agentic Experience. Lead with the actual Chrome interaction and show evidence, approval, and outcome. Full live-model/provider acceptance is the main technical proof still missing; a fixture demonstration must be labeled honestly.

## Demo and visual assets

Use [the timed two-minute script](docs/submission-demo.md). Supporting reproducible flows are [the mission demo](docs/demo.md) and [Launch Review](docs/upgrade-demo.md).

Existing screenshots were inspected during preparation:

- `artifacts/screenshots/mission-desktop.png`: older fixture mission workspace with blocked tasks and an expired recovery proposal. Useful as a UI reference, not a current success/hero shot.
- `artifacts/screenshots/mission-panel-390.png`: older narrow fixture layout; not proof of Chrome's native side-panel interaction.

Capture fresh images/video of the actual installed side panel, evidence preview, editable approval, and persisted result. Keep fixture labels visible. The old screenshots show illustrative mission deadlines that are not this event's 4:30 PM cutoff. No new recording or screenshot is claimed by this packet.

## Local reproduction and verification

Use Node 22+ and the pinned pnpm 10.32.1 in a clean checkout. Follow `README.md` and `docs/setup.md`; do not overwrite an existing private `.env`. For a deterministic rehearsal, explicitly set both `PROVIDER_MODE=fixture` and `MODEL_MODE=fixture` and use a fresh private data directory. Build, run, load `apps/extension/dist` as an unpacked extension, and pair locally. Keep pairing codes out of recordings.

Typical clean-checkout checks:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

Freshly executed in this preparation pass at commit `2fd088bc705e13abfe56f1f92b5f7939f219a854`:

- `tsc --noEmit`: passed using the installed project binary.
- Vitest: 184 tests passed initially; sandbox loopback restrictions prevented 23 tests from running. All five affected API suites were rerun with loopback permission and all 26 tests passed (three overlapped the first pass), covering **207 distinct tests across 21 files**.
- Vite UI and service-worker builds: passed. Upstream browser-externalization and bundle-size warnings remain.
- No browser suite or live provider call was executed in this preparation pass. Six browser passes and the small live OpenRouter probe are earlier recorded results, not new acceptance proof.
- `origin` was fetched; local `main` matches `origin/main`. Existing changes to `docs/tests.md` and the local handoff were preserved.

## Final readiness checklist

- [x] Prepare project name, description, tools, technical explanation, and local test evidence.
- [x] Prepare two-minute demo narration, shot list, and social copy.
- [x] Confirm and enter each person's contribution.
- [ ] Confirm the actual build timeline.
- [x] Authorize/review public repository publication and verify anonymous access after release.
- [ ] Rehearse and record the two-minute demo, then add its shareable URL.
- [ ] Publish the reviewed social post with the required tags and add its public URL.
- [x] Fill and save the prepared name, description, tools, and repository link as an entry draft.
- [ ] Add the missing URLs, review the final values, then obtain explicit approval before the final Submit Entry action.

No final submission action has been taken.
