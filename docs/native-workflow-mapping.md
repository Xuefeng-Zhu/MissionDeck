# Native routine mapping and verification

Checked 2026-09-12 against the public [Ambiguous OpenAPI](https://app.ambiguous.ai/api/openapi.json) using HTTPS curl. The schema contained 939 paths. The [Automations overview](https://www.ambiguous.ai/applications/automations) was also accessible as HTML. The browsing service could not parse these pages; this did not prevent direct public schema inspection. No credentials were supplied, accounts changed, workflows created or runs triggered.

| Mission Control interface | Official operation / schema | Status |
| --- | --- | --- |
| Create disabled private workflow | `POST /api/automations`, `automations_create`, `AutomationCreateInput`: `name`, `description`, `workflow`, `active:false`, `visibility:private` | Documented, untested |
| Workflow structure | `AutomationWorkflow`: `nodes` with `id`, `name`, `type`, `parameters`; `connections` adjacency keyed by node name | Outer shape documented; dispatcher enforces inner shape |
| Discover exact allowed nodes | `GET /api/automations/node-types`, `GET /api/automations/node-types/{type}` | Public unauthenticated catalog request returned HTTP 401; authorization blocked |
| Edit / read back | `PATCH` / `GET /api/automations/{id}` | Documented, untested; workflow patches increment native workflow version |
| Enable / disable triggers | `POST /api/automations/{id}/enable` / `disable` | Documented, untested; no runtime integration enabled |
| Dispatch | `POST /api/automations/{id}/run`, `POST /api/automations/{id}/runs` | Documented, untested; not called |
| Read real runs | `GET /api/automations/{id}/runs`, `GET /api/automations/runs/{runId}` | Documented, untested; UI never invents native run IDs |
| Native test | `POST /api/automations/{id}/test` | Documented to stub action handlers and return empty successful outputs; not live proof |
| Cancel | `POST /api/automations/runs/{runId}/cancel` | Documented to cancel running/suspended runs, prevent scheduled resume; terminal runs return 400. Does not establish rollback of already executed side effects |
| Version history | `GET /api/automations/{id}/versions` and `/{version}` | Documented, untested |
| Schedule/timezone, events, filters, exact action parameters | Authenticated node catalog | Blocked pending exact schemas and authorized test workspace |
| Assistant delegation / native per-action approval | No verified enforceable execution boundary | Not enabled; instructions alone cannot enforce scope |

## Implemented behavior

`RoutineSpec` validates typed bounded steps, dependencies, exact destinations/audiences/sensitive sources, per-run review, inputs, timezone, budgets and lifecycle separately from runs. Discovery requires three separate consented, approved, verified mission histories by default; corrections and failures disqualify proactive matching. It normalizes step identifiers but preserves destinations and sensitive source identities. Fixture history is never mixed with authentic history. Dismissal and pattern suppression persist in scoped local records. Explicit “Make this repeatable” works with one successfully completed mission and stores minimal approved operation metadata, not raw browser content or clickstreams.

The HTTP path derives task-family metadata from authoritative mission operations and approvals, and launch-review metadata from consumed artifact approvals plus plans whose every output has verified read-back. The explicit fixture demo button persists three clearly synthetic comparable Launch Review histories using a fixed September 2026 clock. The native run inspector reads only a stored native workflow ID after provider identity verification, bounds pagination to 50, checks returned workflow/workspace identity, and omits raw trigger payloads. With no verified native IDs, it returns a concrete blocker. Corrections are not inferred from page activity. Only matching records explicitly consented through Make this repeatable are retained.

Preview is a pure local function with no provider/network interface and zero production writes. It returns step descriptions and concrete blockers. `compileAutomation` fails closed while exact nodes, connections and native policy boundaries cannot be verified. No guessed native JSON is emitted. The enable endpoint returns a conflict explaining these blockers; it never changes lifecycle to enabled. Saving any edited routine starts a new draft version and clears native binding/approval assumptions.

The event guard validates authentication/scope, event age, duplicate IDs, self-origin correlation, cooldown, concurrency and browser availability; it only reports eligibility for reviewed input. It is not a deployed event receiver or second workflow engine. Production event ingestion, atomic event claiming and dispatch remain blocked alongside native compilation. Persisting a local operation key alone cannot establish exactly-once delivery.

## Remaining acceptance work

Provide an explicitly authorized test workspace and privately configured credentials. Fetch the real node catalog and per-node schemas, verify exact connection encoding, action permissions, pagination limits, triggers/timezone semantics and per-run approval enforcement. Implement only verified typed mappings, then obtain explicit authorization before creating/enabling and triggering a native test workflow. Inspect the returned native workflow/run IDs and read back every artifact. Native test mode with stubbed actions is not a substitute. Verify disabling a trigger separately from canceling a run already in flight. Do not create an external scheduler while this access is missing.
