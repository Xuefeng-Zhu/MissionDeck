# Research worker boundary

The phase-two `RequirementsResearchWorker` is **disabled**. There is no timer, cloud deployment, queued run, or simulated worker success in this package. Calling its entry point fails explicitly.

The user-requested implementation order requires successful core live acceptance before adding this worker. That acceptance needs real CopilotKit/OpenAI interaction and one approved Ambiguous create/read/update path, followed by the mission loop. Those external credentials were not available during implementation.

Later activation requires all of the following:

- Recorded successful core live acceptance.
- Server-side Trigger.dev project configuration and `TRIGGER_SECRET_KEY`, plus `EXA_API_KEY`.
- A reviewed public research question and explicitly allowed sources/search terms. Private captures are excluded from the search query by default.
- A real Trigger.dev task with bounded retries, concurrency, runtime, result count, and model/tool usage.
- Durable job and artifact state in the application database. Hosted runs need a reachable authenticated persistence path; a loopback database cannot be reached from hosted workers by assumption.
- Source URLs and excerpts, claim verification, and an artifact/proposal result. Mission changes still require the existing approval endpoint.
- Application-level operation tracking and reconciliation. Scheduler deduplication alone does not guarantee exactly-once external effects.

Use the current official setup links and the recorded verification date in [integration notes](../../docs/integrations.md). No SDK version is pinned for an implementation that has not been performed.
