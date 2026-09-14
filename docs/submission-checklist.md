# Agents for Humans submission checklist

This checklist is based on the live Agents for Humans Devpost requirements fetched September 14, 2026. At fetch time, the listed deadline was **5:00 PM Pacific on September 14, 2026**; verify the live event page before relying on this snapshot. This file prepares the packet only; nothing is sent to Devpost by this repository.

## Required project materials

- [x] Name and concise product positioning: **MissionDeck — a release-readiness agent for small product teams**.
- [x] Target track selected in the draft: **Professional Agents**.
- [x] Public repository identified: <https://github.com/Xuefeng-Zhu/MissionDeck>.
- [x] MIT license added at repository root.
- [x] README includes setup instructions, architecture, limitations, trust boundaries, and prior-work disclosure.
- [x] Architecture diagram source added at `docs/architecture.svg`.
- [x] Upload-ready architecture diagram added at `docs/architecture.png`.
- [x] Devpost text draft added at `devpost-submission.md`.
- [ ] Merge/push the final build to the public default branch.
- [ ] Verify the public repository includes all source/setup assets needed to run.
- [x] Verify the public repository exposes the root **MIT License**.
- [ ] Upload `docs/architecture.png` to the required architecture field.
- [ ] Add the user-controlled AWS Builder ID.

## Demo video

- [ ] Record a fresh final master from the MissionDeck/Bedrock build; do not reuse the silent `Mission Control`/OpenRouter recording.
- [ ] Keep runtime at or below **5:00**.
- [ ] Cover the problem, target user, and why the problem matters.
- [ ] Demonstrate the working project end to end.
- [ ] Show the source conflict, parallel Strands work, human decision, Decision Receipt, and changed launch pack.
- [ ] Keep evidence-layer labels readable; do not describe fixtures as live.
- [ ] Remove secrets, pairing codes, personal tabs, and unrelated provider data.
- [ ] Upload to YouTube or Vimeo.
- [ ] Confirm public playback in a signed-out/private browser window.
- [ ] Add the public video URL to `devpost-submission.md` and Devpost.

## Optional public demo

- [ ] Add a live URL only after verifying it from a clean browser session.
- [ ] Confirm one full judge path from source review through Decision Receipt and launch pack.
- [ ] Confirm the app has no local-only URL, pairing-code, or private-environment dependency in that path.
- [ ] Confirm health after a cold start and record deployment revision/time.
- [ ] Confirm safe quotas, concurrency limits, and a kill switch for public model use.
- [ ] Keep the demo available through the judging period, or omit the optional field.

## Official form answers

- [ ] **Submitter Type:** confirm **Team of Individuals** for the owner-confirmed Xuefeng Zhu/Lingyi Kong team, or choose the correct alternative.
- [ ] **Country of Residence:** confirm United States in the final form.
- [ ] **Organization name:** fill only if applicable.
- [x] **Track:** Professional Agents.
- [x] **Public code repository:** <https://github.com/Xuefeng-Zhu/MissionDeck>.
- [ ] **Architecture diagram:** upload `docs/architecture.png`.
- [ ] **AWS Builder ID:** enter directly in the form or approved draft.
- [ ] **Live demo:** optional; use only a verified public URL.
- [ ] **Testing instructions:** copy the final, freshly verified commands from the draft.
- [ ] **Optional bonus post:** publish on builder.aws.com before the deadline or leave blank.
- [ ] **Video URL:** public YouTube or Vimeo URL.

The live form fetched on September 14, 2026 did not request a Codex session ID.

## Final truth and safety review

- [ ] Re-run the final commands in [submission evidence](submission-evidence.md) on the public commit.
- [ ] Update stale test counts and dates rather than carrying historical results forward.
- [x] Inspect the rebuild candidate for `.env`, API keys, tokens, pairing codes, provider exports, and private source text; only `.env.example` plus deliberate synthetic redaction-test strings were found.
- [ ] Check every README and Devpost link from a signed-out browser.
- [ ] Verify the architecture PNG remains readable in Devpost's upload preview.
- [ ] Ensure the repository, video, and optional demo all use the same product name and evidence labels.
- [ ] Keep previous foundation work disclosed and Git history intact.
- [ ] Review the final Devpost preview before the separate submit action.

## Judge-facing pass

The live criteria use a five-point scale for each category. Make the final packet answer each one with visible evidence:

- [ ] **Technological Implementation:** show the real Strands graph, scoped tools, parallel join, structured validation, budgets, and durable coordinator boundary.
- [ ] **Design:** complete one coherent source-to-decision-to-output path without asking judges to understand the generic mission framework first.
- [ ] **Potential Impact:** keep the audience specific to small product teams and show time saved on a real, judgment-heavy launch task.
- [ ] **Creativity & Originality:** foreground the revision-bound Decision Receipt and how a source change invalidates stale authorization.
- [ ] **Presentation:** demonstrate the working flow end to end; name the problem, user, and why it matters; keep labels readable.

## Readiness gate

Do not describe the entry as ready for final submission until the public default-branch build, license detection, architecture upload, AWS Builder ID, and public video playback are all verified. A live demo is optional; a broken or misleading link is worse than leaving that field blank.
