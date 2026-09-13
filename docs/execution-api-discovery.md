# Ambiguous execution API contract

Checked against the [public OpenAPI](https://app.ambiguous.ai/api/openapi.json) on September 12, 2026. Authenticated **read-only** verification of `/api/users/me` and `/api/users?limit=100` confirmed the configured user/workspace match and a complete roster with one human and two agent accounts. This is not evidence of a live mission launch or live write verification. Automated contract tests use synthetic responses; persistence tests use the local database.

| Operation | Documented contract | Adapter behavior |
| --- | --- | --- |
| Resolve people and agents | `GET /api/users?limit=100` → `{data: [{id, display_name, type}], total, has_more}` | Uses native identity IDs and `human` / `agent` types; rejects truncated rosters. |
| Assign work | `POST /api/tasks` supports `assignee_id`, `parent_task_id`, `status` and `description`; response `{task}` | Requires a verified workspace member; reads the saved task and checks every requested field. |
| Update work | `PATCH /api/tasks/{id}` supports the same native assignment/status fields | Checks the prior fingerprint; preserves changed tasks and custom/recurring workflows. There is no documented atomic conditional update. |
| Save dependency | `POST /api/tasks/{id}/relations` with `{target_task_id, type: "blocked_by"}` | Reads before and after creation. Native API creates the inverse `blocking` edge. |
| Save document | `POST /api/documents` with `{type:"doc", title, content, visibility:"restricted"}`; flat document response | Encodes literal draft text as documented ProseMirror JSON, then reads it back and compares the complete text and owner. |
| Share with assigned people/agents | `POST /api/documents/{id}/permissions` with `{user_id, role:"editor"}` | Separate durable step after document creation. Only verified selected workspace users; checks complete native permissions and rejects additional recipients. |
| Read permissions | `GET /api/documents/{id}/permissions` → `{data,total,has_more:false,pending}` | Requires no pending invitations, no team/guest audiences, and only the expected user IDs plus owner. |

Task and document creates have no documented native idempotency guarantee. MissionDeck journals each attempt, retains returned IDs, and does not automatically recreate objects after uncertain outcomes. The fixture adapter persists native-like objects and deduplication records in the scoped database. Fixture results remain explicitly labeled as local fixture data.

Native `POST /api/coworkers/{id}/dispatch` accepts an arbitrary trigger payload, optional playbook, and an idempotency key. The documented dispatch input offers no per-run tool or audience restrictions. This adapter does not expose it or the broad assistant endpoints. MissionDeck's bounded drafting runner produces text from the mission and dependency artifacts; server code performs the reviewed task/document operations.

`GET /api/agents/{id}/transport` reports only whether an external agent is connected. It does not establish execution capability or completion. Registered assignees and the local drafting runner are therefore presented separately.

The document and task response schemas do not provide canonical object URLs. Native links were separately verified on September 12, 2026 in the [official public app bundle](https://app.ambiguous.ai/assets/index-SjTo5KiY.js): its router registers `docs/:id`, its canonical resource resolver builds `/docs/${id}`, and its task notification resolver builds `/tasks?task=${id}`. The adapter uses those exact routes after UUID validation, with the fixed `https://app.ambiguous.ai` origin. Fixture records retain null URLs. The OpenAPI `AssistantRecentActivityEntry.path` also documents `/docs/abc` as an example native route. Task attachments accept **Drive file IDs**, so the adapter does not assume native document IDs are valid Drive attachment IDs.

Task create and update descriptions have no `maxLength` in the public OpenAPI; the execution adapter's 20,000-character cap is local. `task_status_id` is an optional nullable custom status reference whose category overrides the system status. The API does not document whether workspace defaults populate it on creation; the adapter preserves non-null custom status workflows and requires inspection if one appears. Permission-list ownership comes from the document's `owner_id`, combined with user permission entries; the permission-list response has no separate owner property.
