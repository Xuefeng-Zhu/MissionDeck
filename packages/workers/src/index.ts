/**
 * Phase two is intentionally gated on successful core LIVE acceptance.
 * Presence of credentials alone must never enable an unverified worker.
 */
export const requirementsResearchCapability = Object.freeze({
  enabled: false as const,
  state: 'disabled' as const,
  name: 'RequirementsResearchWorker',
  reason: 'Complete the core live Ambiguous create/read/update and CopilotKit acceptance checks before enabling research.',
  requiredServerConfiguration: ['TRIGGER_SECRET_KEY', 'EXA_API_KEY'] as const,
  approvedPublicQueryRequired: true,
  hostedAuthenticatedPersistenceRequired: true,
  automaticMissionChangesAllowed: false,
});

export interface ApprovedResearchRequest {
  missionId: string;
  approvalId: string;
  publicQuestion: string;
  permittedPublicSources: string[];
}

/** No timer, simulated run ID, or optimistic job state is produced. */
export async function enqueueRequirementsResearch(_request: ApprovedResearchRequest): Promise<never> {
  throw new Error(`${requirementsResearchCapability.name} is disabled. ${requirementsResearchCapability.reason}`);
}
