# Run Mission Control locally

Mission Control is a local single-user MVP. The backend binds to loopback, and the extension calls that backend. Do not expose it through a public tunnel or deploy it as a multiuser service.

## Prerequisites

- Node.js 22 or newer.
- pnpm **10.32.1**, as pinned in `package.json`.
- Chrome 116 or newer for the native side panel.
- Docker only if choosing the separate PostgreSQL service. The default persistent PGlite mode does not need Docker.

Check `node --version` and `pnpm --version`. If the pnpm on your PATH is another generation, use `npx --yes pnpm@10.32.1` for the commands below; the package manager override must remain effective.

## Install and start the explicit fixture demo

From the repository root:

```sh
pnpm install --frozen-lockfile
cp -n .env.example .env
pnpm db:migrate
pnpm dev
```

The supplied environment selects `PROVIDER_MODE=fixture`, `MODEL_MODE=fixture`, `MODEL_PROVIDER=bedrock`, and `DATABASE_MODE=pglite`. It also names the inactive Bedrock default, `us.openai.gpt-5.6-luna` in `us-west-2`; no AWS request occurs until model mode is explicitly changed to live. Fixture suggestions and provider responses are labeled in the app; mission records and approvals are persisted locally. No sponsor account is needed for fixture mode. Live model/provider errors never switch these settings automatically.

The copy command preserves an existing `.env`; review its mode flags before starting an existing setup.

The frontend preview is at [localhost:5173](http://127.0.0.1:5173), and the server is at [localhost:4318](http://127.0.0.1:4318). Keep `pnpm dev` running. The preview supports manual evidence and application review; page capture requires the installed extension.

In a second terminal, run:

```sh
pnpm pairing-code
```

Enter that code in **Settings → Pair workspace**. The code is a credential: keep its output private. If `PAIRING_CODE` is empty, the server creates `.data/pairing-code` with owner-only file permissions. The resulting session lasts up to 24 hours and can be revoked from Settings. Browser session storage holds the token; it is not synced between devices.

## Build and load the extension

```sh
pnpm build
```

1. Open `chrome://extensions` yourself and turn on Developer mode.
2. Choose **Load unpacked** and select `apps/extension/dist`.
3. The pairing endpoint accepts the installed extension origin only after the correct pairing code is provided, then binds the issued session to that exact origin. You may also list its exact origin in `ALLOWED_ORIGINS`; broad extension-origin wildcards are not accepted.
4. Pin Mission Control to the toolbar, open an ordinary web page, and click the toolbar action. The native side panel should open.
5. Pair this extension session in Settings. The full-page preview and extension have separate origins and sessions.
6. Capture a page or select text and use a Mission Control context-menu action. Review the preview and explicitly choose **Send to Mission Control**.

After rebuilding, use **Reload** on the unpacked extension. Changing the configured backend requires matching updates to `apps/extension/src/api.ts`, the manifest's host permissions/CSP, and the server origin configuration, followed by a new build. The default backend is `http://127.0.0.1:4318`; changing `PORT` alone does not reconfigure the extension.

`activeTab` grants temporary access after a gesture on the current tab. When navigation loses access, click the extension icon on that tab again. Browser-internal pages, the extension store, some PDF/document viewers, canvas content, and inaccessible frames may need manual text. There is no permission escalation or bypass.

## Persistent PostgreSQL options

Default PGlite data lives under `.data/postgres`. It runs PostgreSQL in-process and persists to disk. Keep one server process against that directory. Session, mission, evidence, approval, operation, and audit data survives reopening the panel and restarting the server.

For standard PostgreSQL instead:

```sh
docker compose up -d postgres
```

Set `DATABASE_MODE=postgres` and the supplied local `DATABASE_URL` in `.env`, then run `pnpm db:migrate` and restart. The Docker service is bound to `127.0.0.1:54329`; its development credentials are not suitable for a hosted system. The named Docker volume and the PGlite directory are separate databases. Changing modes does not migrate existing missions between them.

The initial migration is `apps/server/migrations/001_initial.sql`. Startup also applies its idempotent setup. Do not delete `.data` or a Docker volume to troubleshoot routine connectivity problems; those locations contain saved user work.

## Enable live integrations

Use [integration verification](integrations.md) for exact capabilities and the pending acceptance sequence. Keep credentials in server-only environment configuration or the standard AWS credential chain, never in `VITE_*`, source files, screenshots, chat, or extension storage.

- For Ambiguous, set `AMBIGUOUS_API_KEY` and `PROVIDER_MODE=live`. Read the connected identity, verify it belongs to your intended test workspace, then set `AMBIGUOUS_EXPECTED_USER_ID` and `AMBIGUOUS_EXPECTED_WORKSPACE_ID` and restart.
- Begin with the integration smoke proposal, containing exactly one task. Approve its create, verify its returned ID by read-back, approve a supported update, and verify that update. Full-plan live creation remains gated until that path succeeds.
- Amazon Bedrock is the default live model provider. Set `MODEL_MODE=live`, keep `MODEL_PROVIDER=bedrock`, `AWS_REGION=us-west-2`, and `BEDROCK_MODEL_ID=us.openai.gpt-5.6-luna`, and make AWS credentials available through the standard SDK credential chain. Locally that can be a reviewed shared AWS profile or server-only environment credentials; on AWS, prefer an attached least-privileged IAM role. The principal needs only the Bedrock invocation permissions used by the selected inference profile and account project. Do not put AWS credentials in `.env.example` or any `VITE_*` variable. Restart, open the CopilotKit conversation, and verify a streamed response and a persisted proposal. Configuration or runtime discovery is not proof of model access.
- OpenRouter remains optional: select `MODEL_PROVIDER=openrouter` and configure `OPENROUTER_API_KEY` plus `OPENROUTER_MODEL` (default `openai/gpt-5.6-luna`). Direct OpenAI is also optional: select `MODEL_PROVIDER=openai` and configure `OPENAI_API_KEY` plus `OPENAI_MODEL` (default `gpt-5-mini`). Only the selected vendor and its authentication path are used. Missing credentials or errors never fall back to another vendor.
- Model access and task writes are independent. Keep `PROVIDER_MODE=fixture` while testing live Bedrock, OpenRouter, or OpenAI model work; use the separate Ambiguous smoke workflow before enabling real task writes.
- Trigger.dev and Exa remain disabled until the core live acceptance checks pass. Their missing keys do not block the fixture demo.

Do not create a replacement workspace to resolve a provider 401 or 403. Correct the intended workspace's credential or permissions. An `outcome_unknown` write requires inspection/reconciliation, not a blind create retry.

## Adaptive launch review

The Strands template requires the selected live model to support tools and the configured structured-result mechanism. The default Bedrock configuration uses GPT-5.6 Luna through the US inference profile and Strands' bounded tool-based structured-output path; OpenRouter and direct OpenAI remain explicit alternatives. Workspace mode remains independent: real-model rehearsal can use fixture records, while connected acceptance requires live Ambiguous tasks and documents. The generic fixture mission flow remains available.

Follow the [adaptive launch guide](adaptive-launch.md) for reviewed source snapshots, versioned human decisions, budget limits, and recovery. Its CLI uses an already running dedicated loopback backend, defaults to previewing exact mutation payloads, and requires `--execute` before dispatch. The default CLI backend port is **4332**; set `MISSIONDECK_BASE_URL` to the dedicated server you actually started. Give the CLI the pairing code through `MISSIONDECK_PAIRING_CODE`, or set `MISSIONDECK_DATA_DIR` explicitly to that server's data directory. It never searches for credentials or changes provider/model settings.

```sh
node --import tsx scripts/adaptive-demo.ts --help
```

The [adaptive acceptance record](adaptive-acceptance.md) separates controlled SDK tests, coordinator regression, browser checks, and real connected delivery.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm test:browser
```

See [the test report](tests.md) for checks actually run and manual extension checks still outstanding. Use `pnpm exec playwright install chromium` if the test browser is missing. Fixture tests do not prove live Ambiguous, Bedrock, OpenRouter, or OpenAI access, and full-page tests do not alone prove native toolbar, side-panel, or temporary permission behavior.

Domain tests and exported demo factories use the fixed `DEMO_NOW` clock. The running application uses the real clock for expiring approvals and derives illustrative demo deadlines from the current time. Relative human dates must be confirmed as exact dates in the displayed timezone; the date input is interpreted in that displayed IANA timezone.

For the upgrade, use explicit fixture modes and a fresh local `DATA_DIR`. Browser CI uses `.data/browser-upgrade`, a fixture-only pairing code, and refuses to reuse an existing server when `CI=1`. The server and extension remain loopback-only. Check port collisions before starting; do not stop unrelated processes.
