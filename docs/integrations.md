# Integration verification

Reviewed **2026-09-12**. Documentation and schema retrieval succeeded. This proves the documented interface, not access to a customer's account. `OPENAI_API_KEY`, `AMBIGUOUS_API_KEY`, `TRIGGER_SECRET_KEY`, and `EXA_API_KEY` were absent from the build process environment (presence checks only). No live task was created, changed, or deleted during implementation.

## Selected versions

The exact direct pins below are in package manifests; the lockfile records the complete resolved graph.

| Package | Selected version | Reason |
| --- | --- | --- |
| `@copilotkit/react-core` | `1.70.1` | Official web starter's selected frontend generation |
| `@copilotkit/runtime` | `1.70.3` | Official web starter's selected runtime |
| `@ag-ui/client` | `0.0.59` override | Starter's explicit compatibility override |
| `react`, `react-dom` | `19.2.4` | React 19 frontend |
| `zod` | `4.1.12` | Shared TypeScript boundary schemas |
| `openai` | `6.27.0` | Server-only structured output client |
| `express` | `5.2.1` | Authenticated loopback API/runtime |
| `vite` | `7.3.1` | Locally bundled MV3 frontend |
| `@electric-sql/pglite` | `0.3.15` | Persistent local embedded PostgreSQL demo |
| `pg` | `8.20.0` | Standard PostgreSQL connection option |
| `pnpm` | `10.32.1` | New monorepo package manager |

The package and override evidence is the official [web manifest](https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/apps/web/package.json) and [root manifest](https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/package.json). These are selected pins, not claims to be the latest packages on npm.

## CopilotKit and OpenAI

All frontend components and hooks use `@copilotkit/react-core/v2`: `CopilotKitProvider`, `CopilotChat`, `useAgentContext`, `useFrontendTool`, `useComponent`, and `useHumanInTheLoop`. Styles use `@copilotkit/react-core/v2/styles.css`. The SPA uses an absolute runtime URL. The explicit multi-route client setting avoids older wrapper transport defaults. Current documentation supports Vite and a separately hosted Node runtime. [React SPA guide](https://docs.copilotkit.ai/react-spa)

The server uses `BuiltInAgent` and `CopilotRuntime` from `@copilotkit/runtime/v2`, and `createCopilotExpressHandler` from `@copilotkit/runtime/v2/express`. The handler is mounted behind application authentication and origin checking, with its permissive default CORS disabled. Runtime discovery uses `/api/copilotkit/info`; discovery alone is not a successful model call. [Runtime endpoints](https://docs.copilotkit.ai/backend/runtime-endpoints)

Installed-package verification on 2026-09-12 successfully imported and constructed those exports. The runtime's Express adapter declares Express 4 router types while this app hosts Express 5; the mount contains one documented middleware compatibility assertion. `runtime.test.ts` exercises the real adapter: agent discovery returns 200, an unknown-agent request returns 404 through the parsed-body bridge, and open-ended generative UI/A2UI are disabled. Both tests passed without a model call or credentials.

The live configuration explicitly sets `maxSteps:1`, `maxOutputTokens:1800`, `maxRetries:0`, and `providerOptions.openai.store:false`. The selected `InMemoryAgentRunner` limits retained conversation history to 20 threads, 20 runs per thread, and a 16 MiB cross-thread history target. Those limits do not bound a single active stream, and chat history is not durable across server restarts. Mission records and pending proposals remain durable in the application database. Installed AI SDK/OpenAI adapter peer declarations accept the selected Zod 4.1.12; a newer optional integration's peer warning does not establish a failure of this tested runtime path.

The starter's [AppControl](https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/apps/web/src/components/app-control.tsx) demonstrates context and navigation/proposal tools. Its [GenerativeUI](https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/apps/web/src/components/generative-ui.tsx) demonstrates controlled components and human feedback. Mission Control follows those integration patterns with its own mission components and durable approval boundary. Streamed component arguments can be partial; a rendered approval-looking card is never authorization by itself.

OpenAI credentials remain server-side. `OPENAI_MODEL` is configurable because model availability is account-specific. Structured proposal generation uses a schema-constrained server call and validates its result again before saving a proposal. Official SDK support includes `responses.parse` and `zodTextFormat`; refusals and missing parsed output must fail visibly. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

The extracted structured-result boundary has 13 passing deterministic tests without an OpenAI call. It validates exact source excerpts and scoped references, proposes an explicit optional-to-required upgrade when supported, reuses existing task coverage while preserving estimates/dependencies/blockers, and leaves uncertain matches unchanged. This validates application handling of controlled results, not the accuracy of an actual model response.

`MODEL_MODE=fixture` explicitly selects deterministic demo suggestions and disables real model conversation. A model/network failure in live mode remains an error; it does not silently produce a fixture result. Live streaming and account access remain unverified until configured and exercised.

## Ambiguous capability evidence

The official [developer index](https://www.ambiguous.ai/llms.txt), [MCP guide](https://www.ambiguous.ai/agents/mcp), and [OpenAPI schema](https://app.ambiguous.ai/api/openapi.json) were retrieved. The schema identified itself as OpenAPI `3.1.0`, API version `1195179a5535748e4ffe53978d2fc5082ec09f1c`. Mission Control uses a narrow REST adapter; it does not expose generic MCP or arbitrary authenticated requests to the model.

Verified schema subset:

| Purpose | Official operation | Shape used |
| --- | --- | --- |
| Identity | `GET /api/users/me` | `id`, `workspace_id`, `display_name` |
| Create | `POST /api/tasks` | `title`, `description`, `status`; response `{ task }` |
| Read | `GET /api/tasks/{id}` | UUID path parameter; response `{ task }` |
| Update | `PATCH /api/tasks/{id}` | Only approved `title`, `description`, `status`; response `{ task }` |

The system statuses are `todo`, `in_progress`, `done`, `cancelled`, and `blocked`. No task idempotency or conditional-write request header was documented. Task responses supply IDs but no canonical task URL. The adapter consequently displays actual IDs and leaves links absent. Other documented vendor features are deliberately outside the adapter. [Official API schema](https://app.ambiguous.ai/api/openapi.json)

`discover()` retrieves the current schema, checks its supported subset, and verifies identity. Writes require the returned user and workspace to match `AMBIGUOUS_EXPECTED_USER_ID` and `AMBIGUOUS_EXPECTED_WORKSPACE_ID`. The server rechecks identity before every write and refreshes cached capability checks after five minutes. Credentials never enter extension messages, frontend bundles, or provider errors.

`FIELD_OWNERSHIP` in `apps/server/src/providers/types.ts` declares the boundary. Ambiguous owns the synchronized title, description, and supported status. Mission Control owns mission criteria, executor planning, dependencies, estimates, deadlines, blockers, verification, evidence, approvals, and synchronization metadata. This MVP does not assign vendor users or encode local dependencies as vendor fields.

### Write consistency and limitations

The backend must persist an operation before calling the adapter. The live adapter makes one write attempt and requires a separate read of the returned ID before reporting synchronization. A title-only patch never supplies defaults for description or status.

A pre-update read compares the proposal's last observed fingerprint with the current record. A mismatch yields `conflict` and leaves the human edit untouched. Without native conditional writes, a narrow race remains between that read and PATCH; the subsequent read-back detects mismatched approved fields but cannot make the two requests atomic. Custom-status tasks and recurring completion are blocked for review instead of invoking unapproved workflow side effects.

On a transport timeout or a server error after a possible write, the result is `outcome_unknown`. A successful write response followed by failed read-back retains the actual provider ID in the error. Read that same ID to reconcile. When no ID was returned, inspection is required; title search cannot establish exactly one matching creation, so automatic create retry is disabled. No synthetic link or local operation key is represented as an external exactly-once guarantee.

Automatic provider polling is off. The developer index documents rate-limit headers and `Retry-After`, but this build did not measure the connected workspace's quota. Use the explicit **Sync now** action. [Ambiguous API reliability guidance](https://www.ambiguous.ai/llms.txt)

### First live acceptance sequence

This is a pending acceptance test, not a completed integration claim.

1. In a workspace you control, use its Connect instructions to obtain the least privileged credential needed for task read/write. Put it only in the server `.env`; select `PROVIDER_MODE=live`. Keep `MODEL_MODE=fixture` if only validating the task provider first.
2. Read the connected identity in settings. Verify the displayed person/agent and workspace, set `AMBIGUOUS_EXPECTED_USER_ID` and `AMBIGUOUS_EXPECTED_WORKSPACE_ID`, and restart. Confirm capability discovery enables writes. Do not create a different workspace to work around a 401/403.
3. Prepare a one-task integration proposal in Mission Control. Review the precise task title and description, then approve it using the persisted proposal's approval button. This is the first real external write; chat text is insufficient.
4. Record the returned provider ID. Require successful read-back, refresh/reopen, and use **Sync now** to retrieve that same ID. Verify the real record in the connected workspace using its own navigation; no URL is fabricated.
5. Prepare an approved update of that task's title or description. Verify the diff, approve it, require read-back, and check the changed field. Preserve the operation and approval evidence.
6. Only after create/read/update all pass, approve the full mission plan. Exercise missing evidence, an explicit blocker, and recovery against those records. Capture exact outcomes in the test report.

The [official sponsor setup](https://github.com/CopilotKit/agents-everywhere-starter-kit/blob/main/using-sponsor-tools.md) and [web flow](https://github.com/CopilotKit/agents-everywhere-starter-kit/tree/main/apps/web) informed this sequence. Mission Control adds its own persistent operation ledger and server-enforced approval endpoint.

### Explicit fixture mode

`PROVIDER_MODE=fixture` creates records labeled `fixture-*` in a local persistent provider store. It exercises create/read/update and native fixture deduplication across process restarts. This store simulates an external provider; mission state remains in the application's database. Its conditional updates and idempotency are fixture capabilities only. Test transports in `providers.test.ts` simulate vendor responses and errors; they prove adapter behavior, not connected Ambiguous access.

## Chrome MV3

Official Chrome documentation was checked on 2026-09-12. The manifest requires Chrome 116 because `sidePanel.open` is available from that version. Toolbar and selection-menu handlers call it directly in the user-gesture path, then deliver captured data asynchronously through an expiring inbox. [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)

`activeTab` grants temporary access after an explicit invocation; keeping the panel open does not authorize reading unrelated subsequently visited sites. The extension reports access loss and offers a new toolbar invocation or manual text. [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)

Extension service workers can terminate between events. Mission state and operation execution therefore live on the server, while pending capture state uses session storage and expiry. [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

## Phase two

Trigger.dev and Exa remain **disabled** until the core live acceptance sequence passes and credentials are provided. No local timer is presented as a durable worker. The intended future worker must persist status outside the browser, send only a reviewed public query to search, bound retries/results/runtime, and save artifacts or proposed changes without granting itself approval. No Trigger/Exa SDK is installed or pinned because the gated worker has not been implemented.

The official [Trigger.dev introduction](https://trigger.dev/docs/introduction) and [Exa search guide](https://exa.ai/docs/reference/search-api-guide) were checked as phase-two references. A later implementation must verify its exact SDK versions and documented development flow at that time.

After the gate is satisfied, the documented Trigger.dev setup is to select an account/project, run `npx trigger.dev@latest init`, then `npx trigger.dev@latest dev`, and execute a dashboard test run. The initializer creates `trigger.config.ts` and a task directory; the development process connects to the Trigger.dev platform. Backend triggering uses a server `TRIGGER_SECRET_KEY` from that project's API Keys page. Current imports use `@trigger.dev/sdk`; the `/v3` suffix and old `client.defineJob` API are not the selected generation. Record exact resolved versions before implementation. These commands have **not** been run for this project. [Trigger.dev quick start](https://trigger.dev/docs/quick-start)

Exa supplies keys through its dashboard. The currently documented request is `POST https://api.exa.ai/search` with an `x-api-key` credential, a public `query`, bounded `numResults`, allowed `includeDomains`, and nested `contents.highlights`. The current JavaScript example uses `exa.search(query, { contents: { highlights: true } })`; a later worker should follow its then-current SDK rather than assuming the older starter's `searchAndContents` call remains the preferred API. [Exa coding reference](https://exa.ai/docs/reference/search-api-guide-for-coding-agents)

## Starter attribution

The repository began as a small README and gitignore, not a checked-out incident application. Integration choices were informed by the official starter source and documentation listed above. The mission contracts, schema enforcement, dependency scheduling, capture flow, approval/outbox execution, provider adapters, persistence, and application interface are Mission Control functionality. No starter incident data is presented as live mission data.
