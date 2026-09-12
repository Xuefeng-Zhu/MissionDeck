# Design and interaction review

Reviewed **2026-09-12** against the generated [desktop and side-panel concept](design/concept.png). The interface uses actual React controls and persisted mission records; the concept image is documentation, not a rendered application background.

Rendered evidence:

- [Desktop workspace, 1440 pixels wide](../artifacts/screenshots/mission-desktop.png)
- [Narrow workspace, 390 pixels wide](../artifacts/screenshots/mission-panel-390.png)

Both rendered images and the concept were inspected directly with the image viewer. The concept combines a desktop surface and a 400-pixel panel on one board, so the earlier fixture screenshots capture those surfaces separately. The prior fixture browser run also checked 360, 390, 400, and 480 pixels without horizontal overflow. These screenshots predate the OpenRouter setup-copy update. A narrow full-page viewport demonstrates responsive layout, not the native Chrome side-panel gesture itself.

## Fidelity ledger

| Comparison | Concept evidence | Render evidence and resolution |
| --- | --- | --- |
| Workspace layout | Left mission rail, central vertical plan, right contextual copilot | Retained a 212-pixel rail and 330-pixel copilot with a flexible plan area; narrow view removes the rail and stacks the plan and collapsible copilot |
| Palette and hierarchy | White surfaces, cool slate text, restrained blue actions, fine borders | Retained white panels, blue Capture/Sync treatment, light neutral canvas, understated status colors and borders; no decorative gradients or metrics |
| Typography | Strong mission heading, compact task titles and lighter metadata | Explicit typography for headings, navigation, buttons, fields, task metadata, and status labels; long mission/task names wrap in the narrow view |
| Task anatomy | Numbered vertical rows, status, executor, effort, dependency | Retained that reading order and added expandable details for actual provider IDs, read-back state, and local blockers; dependency labels wrap rather than forcing horizontal scroll |
| Navigation and main actions | Plan/Evidence/Activity; Capture page; Sync now; Add task | Retained those labels and ordering; added functional Verify completion and recovery controls required by the build prompt |
| Copilot/review surface | Right contextual panel with an evidence-based proposal and decision actions | Same panel hosts persisted contract/plan/requirement/recovery/sync/completion cards. Fixture screenshots show actual pending recovery state; edit/reject/approve/refresh use server-backed proposals |
| Icons and branding | Rounded blue M mark, thin line action/navigation icons | Retained the M mark and consistent line icons implemented locally; no remote executable or image dependency |
| Spacing and containers | One plan panel, one copilot panel, lightly bordered task rows | Retained the container model; seven tasks and required verification controls make the completed workflow taller than the six-task concept |
| Responsive controls | Full-width capture/sync actions and compact mission header at panel size | Two readable primary actions remain side by side, metadata wraps, rows expand vertically, and mission selection/settings remain reachable |
| Forms and review feedback | Editable review is implied by proposal controls | Inputs have explicit associated labels; supporting help uses `aria-describedby`. Browser testing caught and fixed accessible names that previously included helper text |
| Recovery and criterion diffs | Human-readable recommended change with supporting context | Replaced raw deadline timestamps with a readable date in the mission timezone, and raw criterion patch data with labeled before/after values |

## Intentional copy and state differences

The concept's sample data is illustrative. Above-the-fold production copy was checked against the requested behavior:

- The long user outcome replaces the shortened “Hackathon submission” sample title. It remains the mission's actual goal rather than a second invented label.
- The running app shows the confirmed exact date and IANA timezone, not an unqualified “Tomorrow.” Demo dates are illustrative and derived from the current time.
- “Blocked” and “0 of 4 verified” reflect the test journey after accepted video evidence and a reported blocker. The concept's “On track” and “0 of 3” are not hardcoded.
- Seven tasks replace the concept's six after the required video is approved. “Reported complete,” “Blocked (local),” provider read-back, and criterion verification have deliberately distinct meanings.
- Fixture provider/planner labels and integration settings replace the concept's generic fixture toggle. Server configuration controls these modes; the UI cannot pretend that toggling a visual switch enables a live integration.
- The concept's claim about monitoring the current page is replaced by explicit capture/review language. Mission Control reads only in response to a capture gesture and sends only reviewed text.
- The chat input is visibly unavailable in fixture mode. It becomes the actual CopilotKit conversation when the live model runtime is configured; a simulated chat is not presented as live AI.
- Stale proposals show a current-review requirement and refresh action. Recovery does not claim a blocker disappeared or promise a known ETA.
- Footer copy describes server-persisted mission state. Broad concept claims such as “No accounts. No tracking.” were omitted because live providers have their own account and processing behavior.

The visual result preserves the concept's layout, palette, hierarchy, and task structure while exposing actual application state. Native Chrome gestures, live streaming, and account-backed provider effects retain their separate acceptance status in the [test report](tests.md).
