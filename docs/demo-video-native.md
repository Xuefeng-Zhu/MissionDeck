# Native Ambiguous assets for the two-minute demo

The CLI at `scripts/demo-video/native-demo.ts` prepares a dedicated demo. Root controls the recording cue and the exact manifest. Each mutating command requires `--execute`; `preview` performs no network requests. Credentials are read from the existing server `.env` configuration and never printed. The recording uses the mission runner's requirements document; bind that existing ID instead of running the document-create command.

```sh
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts preview scripts/demo-video/example-manifest.json
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts requirements scripts/demo-video/example-manifest.json --execute
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts bind-requirements scripts/demo-video/recording-manifest.json --document-id=UUID
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts slides scripts/demo-video/example-manifest.json --execute
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts channel scripts/demo-video/example-manifest.json --execute
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts message scripts/demo-video/example-manifest.json --index=0 --execute
./node_modules/.bin/tsx scripts/demo-video/native-demo.ts status scripts/demo-video/example-manifest.json
```

Root can post each successive message with `--index=1`, `2`, and `3` while recording. The manifest uses `{{documentUrl}}`, `{{slidesUrl}}`, and `{{channelUrl}}` placeholders. Requirements and slides must exist before their links can be posted. Local journals under `scripts/demo-video/state/` are ignored by Git. Each write is journaled before dispatch; interrupted/uncertain steps refuse automatic retry and retain returned native IDs.

The demo scope (label, channel, and participants) is fixed once a journal exists. Later message cues and unexecuted slide content may be prepared in the manifest; every already-executed step retains its exact input hash. `bind-requirements` is native-read-only: it checks the selected document and audience, then records the source ID locally without creating or editing a native document.

## Verified native contracts

Read from the [official OpenAPI](https://app.ambiguous.ai/api/openapi.json) on September 12, 2026:

- **Requirements:** `POST /api/documents` with `type: "doc"`, a labeled title, ProseMirror JSON content, and `visibility: "restricted"`. Read the same document and compare all text, owner, and visibility.
- **Slides:** `POST /api/slides` creates one blank restricted deck. `PATCH /api/slides/{id}/slides/0` replaces that newly created slide's elements. `POST /api/slides/{id}/slides` appends a full `slide` object. `GET /api/slides/{id}/data` returns `data.slides[].elements[]` for exact visible-text read-back. The public `SlideTextElement` schema specifies `id`, `type: "text"`, `x`, `y`, `w`, `h`, and `text`; typography and colors are documented optional fields. These are real native editable text/shape elements, not notes-only slides. Each bullet has its own text element.
- **Artifact access:** `POST /api/documents/{id}/permissions` with selected workspace `user_id` and `role: "editor"`; both Docs and Slides use the document permissions surface. The complete read-back audience must equal the human owner plus the uniquely resolved selected Codex/Hermes agent accounts.
- **Private channel:** `POST /api/channels` with `type: "private"`, `preset: "conversation"`, a `demo-` name, description, and exact `member_ids`. `GET /api/channels/{id}` must confirm private visibility, owner, member count, and precisely the selected user IDs before any message.
- **Chat:** `POST /api/channels/{channel_id}/messages` with Markdown `content` and `starts_new_block: true`. Read back the returned message ID from the same channel and verify its complete content and actual native author. No mentions, external recipients, public channels, existing channel edits, or coworker dispatch.

The native API derives chat authors from the credential; there is no supported `author_id` override. Messages sent with the existing human credential show that human as the author. Agent contributions are explicitly labeled in the body and explain that MissionDeck posts through the authorized human connection. This demonstrates agent-authored work without pretending a separate external agent runtime sent it.

Native routes are verified in the official current app bundle: `/docs/{uuid}`, `/slides/{uuid}`, `/chat/{uuid}`. The CLI prints only non-secret identities, IDs, result URLs, and journal status.

## Recording workspace evidence

Under the explicit root recording cue, the CLI created private channel `missiondeck-hackathon-demo`, ID `a74ceb99-488c-4597-a512-c115e3634a35`, with the exact reviewed description and precisely two members: the configured human and Codex. Read-back confirmed private visibility, creator, member count, and both IDs. [Open the private demo channel](https://app.ambiguous.ai/chat/a74ceb99-488c-4597-a512-c115e3634a35).

The first exact reviewed message was posted and read back as ID `7d5a2978-6804-46d0-8bf7-84641355fe52`. Its body starts `MissionDeck agent update (server drafting worker):`; the verified native author remains the actual human account. No native agent impersonation or coworker dispatch occurred. Both existing agent transport checks reported disconnected; native coworker rows were ACTIVE but last activity was null and skill scope unrestricted. This is not evidence that those external runtimes executed the mission.

No duplicate requirements document or slide deck was created during the initial channel cue.

Under the subsequent explicit slide cue, existing requirements document `207d1252-33cf-48e5-afc3-068c9e92c992` was bound read-only. A new restricted native deck, `dbe3223c-33e0-4b69-9f9f-0bf01720f68e`, was created with exactly the four reviewed slides. All visible text and element geometry read back successfully; body copy is 32 points with white headings, mint accent, and navy backgrounds. The verified deck audience is the configured human and Codex only. [Open the native demo slides](https://app.ambiguous.ai/slides/dbe3223c-33e0-4b69-9f9f-0bf01720f68e).

The separate read-only proof is saved at `scripts/demo-video/verified-native-slides.json`. No chat-feedback-to-mission handoff was performed and no storyboard completion is claimed.

At the explicit delivery cue, the exact reviewed integration update was appended to the recording manifest and posted as message `dba0a93b-05df-4863-8515-87b49b8c50dc`. Its complete content and actual human author were read back from the same verified two-member private channel. It links the saved requirements and four-slide deck, says the storyboard still awaits the review being saved with the mission, and clearly distinguishes the connected human chat account from the MissionDeck server drafting worker.
