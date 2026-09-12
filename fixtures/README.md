# Labeled demo fixtures

These are fictional requirements and synthetic privacy test data. They do not establish an actual event deadline, an OpenAI response, or successful Ambiguous writes.

With the local server running, open [requirements](http://127.0.0.1:4318/fixtures/requirements.html), [privacy checks](http://127.0.0.1:4318/fixtures/privacy-check.html), or the [fixture index](http://127.0.0.1:4318/fixtures/index.html). The server also serves the requirements page at `/fixtures/`.

To serve only these static fixtures on a separate loopback port, run from the repository root:

```sh
python3 -m http.server 4174 --bind 127.0.0.1 --directory fixtures
```

The static pages do not submit forms, execute application scripts, or contact external services. Do not enter real secrets in the privacy test controls.

## Clock and calculated schedule

The domain fixture uses `2026-09-12T16:00:00.000Z`, which is September 12, 2026, 9:00 AM in `America/Los_Angeles`. Its illustrative deadline is five hours later, `2026-09-12T21:00:00.000Z` (2:00 PM). Domain factory callers can pass a different ISO clock and an overridden exact deadline. The running server uses its real clock for approval expiry; setting a fixture clock must not freeze authorization expiry.

[scenario.json](scenario.json) records expected values for the fixed scenario. The application calculates projections from tasks rather than reading these expected totals into its health display.

| Plan state | Projected remaining time | Fixed-clock finish | Interpretation |
| --- | ---: | --- | --- |
| Six-task initial plan | 270 minutes | 1:30 PM PDT | Fits the illustrative deadline |
| Add the required demo video | 350 minutes | 2:50 PM PDT | Exceeds the deadline by 50 minutes |
| Defer optional polish | 300 minutes | 2:00 PM PDT | Fits under the stated assumptions |
| Core implementation explicitly blocked | Unknown | Unknown | Independent drafting can proceed; the blocker remains unresolved |

Assumptions: one concurrent task per human owner, two concurrent agent tasks, continuous availability, non-preemptive tasks, and user-reviewed remaining-effort estimates. These are provisional projections, not working-calendar commitments. Unknown estimates and unresolved blockers prevent an exact ETA.

## Requirements capture scenario

1. Create the labeled demo mission and confirm the exact contract and deadline.
2. Generate its proposed plan. Review and approve the displayed operations.
3. In fixture provider mode, inspect the explicitly simulated local task IDs. In separately configured live mode, require real provider read-back before claiming integration success.
4. Open `requirements.html` and select the paragraph with `id="demo-video-requirement"`.
5. Use the “Add to mission” selection menu. Inspect the preview, destination mission, and source URL, then send it.
6. Review and approve the proposed video criterion and task. Repeat the same capture to check that no duplicate task is created.
7. Compare the 350-minute projection with the initial 270-minute projection. Approving optional-polish deferral should produce 300 minutes.
8. Introduce the clearly labeled fixture blocker on core implementation. Review affected dependencies and at most two recovery options. The ETA must stay unknown until the blocker is explicitly resolved and any missing estimate is supplied.
9. Reopen the workspace and inspect persisted evidence, approvals, provider state, and activity. Checked tasks alone must not satisfy required-criterion verification.

## Privacy capture checks

`privacy-check.html` includes test elements inside the readable `<main>` so a capture implementation must inspect element ancestry and visibility instead of copying all text indiscriminately.

Expected preview inclusions:

- `PUBLIC_CAPTURE_MARKER`
- `PUBLIC_AFTER_HIDDEN_MARKER`

Expected exclusions include markers in password/email input values, a textarea, select, hidden input, output, `contenteditable`, a custom textbox, `hidden`, `aria-hidden`, CSS `display: none`, `visibility: hidden`, opacity zero, a hidden ancestor, template, script data, canvas fallback, and sandboxed iframe.

Select inside a draft or across a private node to verify the explicit refusal/manual-entry path. Append `?token=FAKE_URL_SECRET&session=FAKE_SESSION#FAKE_FRAGMENT` to check that the source preview and accepted source remove secret parameters and fragments. Every secret-looking value here is a synthetic marker.

These pages support repeatable capture checks. They do not prove native toolbar/side-panel behavior or temporary permission loss on another website. Follow the unpacked-extension checks in the test report and record those results separately.
