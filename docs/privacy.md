# Privacy and data handling

Mission Control reads page context only after a person invokes a capture action and transmits it only after that person sends the reviewed excerpt. It does not collect browsing history, cookies, other tabs, or permanent page content in the background.

## Capture and preview

The extension requests only `sidePanel`, `activeTab`, `scripting`, `contextMenus`, and `storage`, plus host access to the configured local backend. A capture reads the current selection or readable main content, with a 20,000-character limit. The UI shows editable text, its source, its destination mission, and truncation before sending.

Capture code excludes form controls, password fields, scripts, hidden content, and editable drafts. Unsupported pages fall back to text supplied by the person. These exclusions reduce collection; the preview is still the place to remove anything private or irrelevant. Do not paste secrets into a manual note.

Source URLs have credentials, fragments, and query parameters removed by the extension. The backend repeats URL validation and redacts recognized secret patterns from accepted text. Secret screening is a best-effort safeguard, not a guarantee that arbitrary private information can be detected. Source URLs are citations; accepting one does not cause the backend to fetch it.

Unsent captures remain in extension session storage and UI memory for a short expiring preview (currently ten minutes). Sending, discarding, or expiry clears the pending inbox. Expired entries encountered when the panel reopens are cleared. Chat does not receive the pending preview. Closing the browser ends the extension session storage lifecycle.

## Where accepted data goes

| Destination | Data | Conditions |
| --- | --- | --- |
| Local application database | Mission contract, tasks, dependencies, estimates, accepted excerpts/source URLs, approvals, events, and provider mappings | After a paired request |
| Local fixture provider store | Simulated task title, description, status, IDs, and operation deduplication | Explicit `PROVIDER_MODE=fixture` |
| Ambiguous | Approved task title, description, and supported status | Explicit live mode, verified workspace identity, exact proposal approval |
| OpenAI | Minimal active mission context and accepted evidence needed for planning/assessment; CopilotKit conversation/tool context | Explicit `MODEL_MODE=live` with server credential |
| Trigger.dev / Exa | None in this build | Phase two is disabled |

CopilotKit provides the contextual interaction and controlled React cards. The backend remains authoritative. This build does not configure managed CopilotKit Intelligence persistence or send it a separate project credential. CopilotKit runtime telemetry is disabled by default with `COPILOTKIT_TELEMETRY_DISABLED=true`. Sponsor credentials stay on the server and are not bundled into the extension.

Structured OpenAI proposal requests and the CopilotKit agent's OpenAI provider options specify `store:false`. Provider processing and retention remain governed by the account's own settings and terms; the application does not claim zero retention by external vendors.

## Retention and controls

Accepted excerpts are retained with the mission, rather than preserving page HTML, screenshots, or full browsing records. The capture limit is a maximum, not a requirement to retain an entire page: shorten the preview to the evidence the mission needs.

- **Discard** removes an unsent capture from the pending inbox.
- **Revoke this session** invalidates the current application session; it does not delete saved missions.
- **Delete local mission data** in Settings requires typing `DELETE`, then calls the paired `DELETE /api/missions/:id` API. It removes that exact mission and its associated local evidence, approvals, artifacts, events, and mappings. It does not delete external Ambiguous records or vendor-retained model data. Pending provider operations must finish before local deletion.
- There is no automatic retention sweep for accepted mission data in this MVP. Local database backups and Docker volumes are separately controlled by the person operating the app.

The application session is revocable, limited to the paired origin, and stored in browser session storage, not synchronized storage. Provider credentials are read from server environment configuration. The pairing code and `.env` must be kept private.

## Local-demo boundary

The server is intended for one local user and binds to loopback. Origin restrictions and a pairing credential protect the API. This is not a hosted multiuser authentication system. Running it behind a public tunnel or sharing its data directory is unsupported.

Webpage instructions and provider/model content are untrusted data. They cannot approve proposals, execute code, change tool permissions, or make arbitrary authenticated HTTP requests. Only allowlisted application actions are available. Live provider errors are shown as errors, conflicts, or unknown outcomes; they are never replaced with simulated success.
