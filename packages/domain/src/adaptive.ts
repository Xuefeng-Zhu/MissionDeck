import { z } from 'zod';

export const adaptiveSourceSchema = z.object({
  id: z.string().min(1).max(100).regex(/^[\w-]+$/),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(20000),
  provenance: z.enum(['pasted', 'browser']),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  capturedAt: z.string().datetime().optional(),
  evidenceId: z.string().max(160).optional(),
}).strict();
export const adaptiveSourcesSchema = z.array(adaptiveSourceSchema).min(1).max(5)
  .refine(sources => sources.reduce((n,s) => n+s.content.length,0) <= 20000, 'Sources must total at most 20,000 characters.')
  .refine(sources => new Set(sources.map(s => s.id)).size === sources.length, 'Source IDs must be unique.');
export type AdaptiveSourceInput = z.infer<typeof adaptiveSourceSchema>;
export interface AdaptiveSource extends AdaptiveSourceInput { fingerprint: string; documentId?: string }
export interface AdaptiveSourceRevision { revision: number; sources: AdaptiveSource[]; createdAt: string; changeSummary: string }
export const sourceCitationSchema = z.object({ sourceId: z.string().min(1).max(100), sourceRevision: z.number().int().positive(), excerpt: z.string().min(1).max(1500) }).strict();
export type SourceCitation = z.infer<typeof sourceCitationSchema>;
export const adaptiveFindingSchema = z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(300), detail: z.string().min(1).max(2000), kind: z.enum(['readiness','risk','conflict']), citations: z.array(sourceCitationSchema).min(1).max(8) }).strict();
export const adaptiveAnalysisSchema = z.object({
  summary: z.string().min(1).max(4000), findings: z.array(adaptiveFindingSchema).min(1).max(20),
  unresolvedRequirements: z.array(z.string().min(1).max(1000)).max(20),
  options: z.array(z.object({ id: z.string().min(1).max(100), label: z.string().min(1).max(200), description: z.string().min(1).max(2000), consequences: z.array(z.string().min(1).max(1000)).min(1).max(8) }).strict()).min(2).max(3),
  recommendedOptionId: z.string().min(1).max(100), assumptions: z.array(z.string().min(1).max(1000)).max(12),
}).strict().refine(a => new Set(a.options.map(o=>o.id)).size===a.options.length && a.options.some(o=>o.id===a.recommendedOptionId), 'Options need unique IDs and a valid recommendation.');
export type AdaptiveAnalysis = z.infer<typeof adaptiveAnalysisSchema>;
export const launchPackSchema = z.object({
  brief: z.string().min(1).max(12000), checklist: z.array(z.string().min(1).max(1200)).min(1).max(20),
  announcementDraft: z.string().min(1).max(10000), unresolvedRisks: z.array(z.string().min(1).max(1200)).max(20),
  changeSummary: z.string().min(1).max(4000), citations: z.array(sourceCitationSchema).min(1).max(20),
}).strict();
export type LaunchPack = z.infer<typeof launchPackSchema>;
export interface AdaptiveDecision { optionId: string; constraints: string; actorId: string; at: string; sourceRevision: number; analysisVersion: string }
export type AdaptiveResult = {kind:'analysis';analysis:AdaptiveAnalysis}|{kind:'launch_pack';pack:LaunchPack};
export interface AdaptiveState {
  revision: number; sourceRevision: number; sourceHistory: AdaptiveSourceRevision[];
  analysis?: {version:string;sourceRevision:number;value:AdaptiveAnalysis};
  decision?: AdaptiveDecision; pack?: {sourceRevision:number;value:LaunchPack}; previousPack?: LaunchPack;
  budget: {modelCalls:number;toolCalls:number;maxModelCalls:number;maxToolCalls:number};
}
export interface AdaptiveActivity {id:string;runId:string;sourceRevision:number;at:string;agent:string;kind:'agent_start'|'agent_end'|'tool_start'|'tool_end'|'model_call'|'error';tool?:string;toolCallId?:string;outcome?:'succeeded'|'failed'|'cancelled';sourceId?:string;summary:string}
export const adaptiveSourcesUpdateSchema = z.object({requestId:z.string().uuid(),expectedRevision:z.number().int().positive(),sources:adaptiveSourcesSchema}).strict();
export const adaptiveDecisionInputSchema = z.object({requestId:z.string().uuid(),expectedRevision:z.number().int().positive(),analysisVersion:z.string().min(1).max(200),optionId:z.string().min(1).max(100),constraints:z.string().trim().max(4000).default('')}).strict();
export const adaptiveReopenSchema = z.object({requestId:z.string().uuid(),expectedRevision:z.number().int().positive()}).strict();
export const ADAPTIVE_SAMPLE_SOURCES: AdaptiveSourceInput[] = [
  {id:'requirements',title:'Product requirements — fictional Harbor launch',provenance:'pasted',content:'Fictional demo: Harbor helps small agencies coordinate client projects. Launch next Friday to 100 customers. The announcement promises a working calendar integration. Required deliverables: launch brief, readiness checklist, announcement draft, and unresolved risks. Human owner must decide how to handle launch blockers.'},
  {id:'engineering',title:'Engineering status — fictional Harbor launch',provenance:'pasted',content:'Fictional demo: Core project boards and invitations have passed acceptance tests. Calendar integration is not ready; its consent flow fails and engineering needs two more weeks. A private beta with 20 customers can use manual date entry. No claim that the integration works is supported.'},
  {id:'feedback',title:'Customer feedback — fictional Harbor launch',provenance:'pasted',content:'Fictional demo: Five pilot agencies value shared ownership and clear deadlines. Three can join a 20-customer private beta using manual date entry. Two require calendar integration before a broader rollout. Customers want honest limitations in the announcement.'},
];
