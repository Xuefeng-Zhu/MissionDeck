# Privacy and data handling

MissionDeck reads page context only after a person invokes a capture action and transmits it only after that person sends the reviewed excerpt. It does not collect browsing history, cookies, other tabs, or permanent page content in the background. The public hosted demo does not expose page capture or manual evidence upload; it starts with editable fictional Harbor sources.

## Capture and preview

The extension requests only `sidePanel`, `activeTab`, `scripting`, `contextMenus`, and `storage`, plus host access to the configured local backend. A capture reads the current selection or readable main content, with a 20,000-character limit. The UI shows editable text, its source, its destination mission, and truncation before sending.

Capture code excludes form controls, password fields, scripts, hidden content, and editable drafts. Unsupported pages fall back to text supplied by the person. These exclusions reduce collection; the preview is still the place to remove anything private or irrelevant. Do not paste secrets into a manual note.

Source URLs have credentials, fragments, and query parameters removed by the extension. The backend repeats URL validation and redacts recognized secret patterns from accepted text. Secret screening is a best-effort safeguard, not a guarantee that arbitrary private information can be detected. Source URLs are citations; accepting one does not cause the backend to fetch it.

Unsent captures remain in extension session storage and UI memory for a short expiring preview (currently ten minutes). Sending, discarding, or expiry clears the pending inbox. Expired entries encountered when the panel reopens are cleared. Chat does not receive the pending preview. Closing the browser ends the extension session storage lifecycle.

## Where accepted data goes

| Destination | Data | Conditions |
| --- | --- | --- |
| Application database | Mission contract, tasks, dependencies, estimates, accepted excerpts/source URLs, approvals, events, and provider mappings | Local mode uses the operator's PGlite data directory; hosted mode uses PostgreSQL |
| Local fixture provider store | Simulated task title, description, status, IDs, and operation deduplication | Explicit `PROVIDER_MODE=fixture` |
| Ambiguous | Approved task title, description, and supported status | Explicit live mode, verified workspace identity, exact proposal approval |
| Amazon Bedrock (default live model provider) | Minimal active mission context and accepted evidence needed for planning/assessment; CopilotKit conversation/tool context | Explicit `MODEL_MODE=live`, `MODEL_PROVIDER=bedrock`, configured region/model, and standard AWS credential-chain access |
| OpenRouter and its selected upstream model provider | Minimal active mission context and accepted evidence needed for planning/assessment; CopilotKit conversation/tool context | Explicit `MODEL_MODE=live`, `MODEL_PROVIDER=openrouter`, and server credential |
| Direct OpenAI | The same bounded planning/assessment and CopilotKit context | Explicit `MODEL_MODE=live`, `MODEL_PROVIDER=openai`, and server credential |
| Trigger.dev / Exa | None in this build | Phase two is disabled |

CopilotKit provides the contextual interaction and controlled React cards. The backend remains authoritative. This build does not configure managed CopilotKit Intelligence persistence or send it a separate project credential. CopilotKit runtime telemetry is disabled by default with `COPILOTKIT_TELEMETRY_DISABLED=true`. Sponsor credentials stay on the server and are not bundled into the extension.

Live model traffic originates on the application server. Amazon Bedrock is the default and receives requests through its Converse APIs in the configured AWS region; authentication comes from the standard AWS credential chain, preferably an attached least-privileged IAM role on AWS. OpenRouter routes requests to its selected upstream model provider, while direct OpenAI requests go to OpenAI. Credentials remain server-side, and only the explicitly selected vendor is used. No Bedrock, OpenRouter, or OpenAI host permission is added to the extension.

OpenRouter and direct OpenAI requests specify `store:false` where their APIs support it. That field does not establish a retention guarantee across OpenRouter or its upstream providers. Bedrock requests use the Converse contract rather than an OpenAI `store` field. Processing, optional model-invocation logging, and retention remain governed by the selected vendor, AWS account settings, upstream provider, and applicable service terms; the application does not claim zero retention by external vendors.

## Retention and controls

Accepted excerpts are retained with the mission, rather than preserving page HTML, screenshots, or full browsing records. The capture limit is a maximum, not a requirement to retain an entire page: shorten the preview to the evidence the mission needs.

- **Discard** removes an unsent capture from the pending inbox.
- **Revoke this session** invalidates the current application session. In local paired mode it does not delete saved missions. In the hosted public demo it also schedules that anonymous session's isolated missions and related records for deletion. If a model call is in flight, the server first cancels it and retains its execution lease and supporting records until the call has unwound; the next cleanup sweep removes the scope.
- **Delete local mission data** in Settings requires typing `DELETE`, then calls the paired `DELETE /api/missions/:id` API. It removes that exact mission and its associated local evidence, approvals, artifacts, events, and mappings. It does not delete external Ambiguous records or vendor-retained model data. Pending provider operations must finish before local deletion.
- Local paired missions have no automatic retention sweep in this MVP. Local database backups and Docker volumes are separately controlled by the person operating the app.
- Hosted public-demo sessions expire after four hours. The server checks once per minute and removes expired anonymous sessions and their isolated missions. Explicit revoke invalidates access immediately. If work is in flight, its records remain only while the execution lease is active, then are removed by the next cleanup sweep (normally within about a minute; an interrupted server may retain them until the lease expires and cleanup resumes). Database backups may follow the host's separate retention policy.

The application session is revocable, limited to the paired origin, and stored in browser session storage, not synchronized storage. Provider credentials are read from server environment configuration. The pairing code and `.env` must be kept private.

## Deployment boundaries

Local mode is intended for one operator and binds to loopback. Origin restrictions and a pairing credential protect that API. Running local mode behind a public tunnel or sharing its data directory is unsupported.

Hosted public-demo mode is a separate, deliberately narrow path. It uses same-origin anonymous sessions with unique owner/workspace IDs, PostgreSQL, fictional fixture workspace records, one mission per session, bounded source revisions and model calls, shared concurrency and daily model-call limits, and four-hour expiry. It disables general planning, evidence upload, free-form Copilot conversation, external workspace writes, task retry/reassignment, and integration actions. Rate and spend controls reduce abuse but are not an identity system; do not enter personal, confidential, regulated, or credential material. The model provider still receives the reviewed source text needed for analysis.

Webpage instructions and provider/model content are untrusted data. They cannot approve proposals, execute code, change tool permissions, or make arbitrary authenticated HTTP requests. Only allowlisted application actions are available. Live provider errors are shown as errors, conflicts, or unknown outcomes; they are never replaced with simulated success.

The incremental context/workspace feature has additional [browser consent, temporary retention, screenshots and revocation controls](browser-context-privacy.md). Automatic extraction consent is distinct from automatic sharing. The existing explicit accepted-evidence path remains available. Native capability states and consequential-action gaps are detailed in [the capability matrix](ambiguous-capabilities.md); local proposals never imply sent mail, posted chat, invitations or native workflow activation.
