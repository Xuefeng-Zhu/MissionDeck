# Mission Control UI implementation

Reference concept: `/Users/frank/.codex/generated_images/01a096f3-9850-75b0-a383-758675affd41/exec-71d13c80-96fc-4514-9e74-26d75098e60e.png`.

The concept is a code-native, white productivity workspace: a light slate mission rail, an open mission header, restrained blue actions, a vertical task list, and a right-hand copilot with source-backed review cards. At 360–480px the mission rail becomes a compact switcher, the task list stays vertical, and the copilot can expand below it.

Tokens are implemented in `packages/ui/src/styles.css`: white content surfaces; `#f8fafc` rail; `#14213d` text; `#64728c` secondary text; `#e5eaf1` borders; `#225cff` accent; 6–9px control/panel corners; system sans-serif stack with deliberate UI sizing. Lucide outline icons match the reference's light stroke language. The simple M mark is native UI text.

Functional changes from illustrative concept copy are intentional:

- The title, task count, status, dates, estimates, dependencies, verification count, and provider details come from server state. No example task is represented as done by default.
- The copilot describes explicit review and accepted evidence. It makes no claim to monitor browsing continuously.
- Provider mode and planning mode are independently labeled. No claim of no accounts or blanket local-only processing is shown.
- Unsent capture previews, real approval diffs, editable contracts, identity/pairing settings, blockers, and human attestations are required workflow states, implemented in the same visual system.
- Fixture planning has disabled conversation copy and uses the same persistent review-card components. Live mode registers those components in the actual CopilotKit v2 runtime.

Browser verification and fidelity screenshots are recorded by the delivery test report after dependency installation. This file does not claim unperformed visual verification.
