# Hermes and Codex connected to Ambiguous

Created two separate **member** agents in Xuefeng's existing workspace on September 12, 2026:

| Agent | Workspace address | Agent ID |
| --- | --- | --- |
| Hermes | hermes@xuefengs-workspace.ambi.cc | fa97a984-313a-4d93-9a58-788d2bd08130 |
| Codex | codex@xuefengs-workspace.ambi.cc | 6dfd27b9-c51a-41fb-acc3-85ad7eac7a33 |

Both keys have full access within the member role and expire **October 12, 2026 at 00:00 Pacific** (`2026-10-12T07:00:00Z`). Each agent has exactly one key; its initial unbounded key was revoked. Neither agent uses the owner's personal key.

Installed on Azure VM `rg-hermes-agent-westus3/vm-hermes-agent-arm` for `azureuser`:

- Hermes: Ambiguous MCP added to `~/.hermes/config.yaml`, with its separate credential in `~/.hermes/.env`. Existing Apify and Stitch settings were preserved.
- Codex: Ambiguous MCP added to `~/.codex/config.toml`, with its separate credential in `~/.config/ambiguous/codex.env`. Use `~/.local/bin/codex-ambiguous` to start Codex with this credential. The stock Codex launcher is unchanged.
- Credentials and configuration files use mode `0600`; the dedicated launcher uses `0700`. Previous configuration backups are in `~/.config/ambiguous/backups/20260912T220108Z-5621fa32`.

Verified live from the VM: both REST identities and MCP `auth_whoami` match their distinct agent IDs and the intended workspace; both discover 856 MCP tools. Hermes's native single-server probe passed. Codex's native app-server initialization and MCP status/catalog request passed. No model turn or business operation was used for verification.

Both agents also appear in Chrome's Ambiguous Admin user list. Credentials were transferred in an encrypted envelope through Azure managed commands; no SSH/firewall change was made. The temporary transfer private key and local plaintext agent-key copy were removed.

The existing `hermes-gateway.service` was restarted after the user approved it and the runtime reported health `ok`, zero active runs, and zero active streams. Verification confirmed a new active gateway process and healthy WebUI after the restart. Fresh Hermes sessions and the `codex-ambiguous` launcher passed native connection checks.

This setup provides agent identities and MCP access; it does not create a background Ambiguous task-polling worker.
