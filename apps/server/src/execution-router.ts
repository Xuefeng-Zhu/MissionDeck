import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest } from './auth.js';
import { ExecutionService } from './execution-service.js';
import { AmbiguousExecutionProvider, FixtureExecutionProvider } from './execution-provider.js';
import { ModelExecutionRunner } from './execution-runner.js';
import { StrandsExecutionRunner } from './strands-execution-runner.js';
import { UpgradeStore } from './upgrade-store.js';
import { config } from './config.js';
import type { Database } from './database.js';

const scope = (req: Request) => (req as AuthenticatedRequest).principal;
const id = (req: Request, name: string) => z.string().min(1).max(200).regex(/^[\w.:-]+$/).parse(req.params[name]);
export function createExecutionService(db: Database) {
  const store = new UpgradeStore(db);
  const live = new AmbiguousExecutionProvider({ apiKey: config.AMBIGUOUS_API_KEY, expectedUserId: config.AMBIGUOUS_EXPECTED_USER_ID, expectedWorkspaceId: config.AMBIGUOUS_EXPECTED_WORKSPACE_ID });
  return new ExecutionService(db, s => config.PROVIDER_MODE === 'fixture' ? new FixtureExecutionProvider(store, s) : live, new ModelExecutionRunner(), undefined, new StrandsExecutionRunner());
}
export function createExecutionRouter(service: ExecutionService) {
  const router = Router();
  router.get('/execution/capabilities', async (req, res) => res.json(await service.capabilities(scope(req))));
  router.post('/execution/missions', async (req, res) => res.status(201).json(await service.start(req.body, scope(req))));
  router.get('/missions/:id/execution', async (req, res) => res.json({ execution: await service.get(id(req,'id'), scope(req)) }));
  router.post('/missions/:id/execution/sources',async(req,res)=>res.json({execution:await service.updateSources(id(req,'id'),scope(req),req.body)}));
  router.post('/missions/:id/execution/decision',async(req,res)=>res.json({execution:await service.decide(id(req,'id'),scope(req),req.body)}));
  router.post('/missions/:id/execution/reopen',async(req,res)=>res.json({execution:await service.reopen(id(req,'id'),scope(req),req.body)}));
  router.post('/missions/:id/execution/control', async (req, res) => {
    const input = z.object({ action: z.enum(['pause','resume','cancel','complete']), attestation: z.string().trim().min(10).max(500).optional() }).strict().parse(req.body);
    await service.control(id(req,'id'), scope(req), input.action, input.attestation); res.json({ execution: await service.get(id(req,'id'), scope(req)) });
  });
  router.post('/missions/:id/execution/tasks/:taskId/review', async (req, res) => {
    const input = z.object({ feedback: z.string().trim().min(3).max(20000) }).strict().parse(req.body);
    res.json({ execution: await service.review(id(req,'id'), id(req,'taskId'), scope(req), input.feedback) });
  });
  router.post('/missions/:id/execution/tasks/:taskId/retry', async (req, res) => {
    z.object({}).strict().parse(req.body); res.json({ execution: await service.retry(id(req,'id'), id(req,'taskId'), scope(req)) });
  });
  router.post('/missions/:id/execution/tasks/:taskId/reassign', async (req, res) => {
    const input = z.object({ assigneeId: z.string().min(1).max(160) }).strict().parse(req.body);
    res.json({ execution: await service.reassign(id(req,'id'), id(req,'taskId'), scope(req), input.assigneeId) });
  });
  router.post('/missions/:id/execution/reconcile', async (req, res) => {
    const input = z.object({ operationId: z.string().min(1).max(200), providerId: z.string().min(1).max(160).optional() }).strict().parse(req.body);
    res.json({ execution: await service.reconcile(id(req,'id'), scope(req), input.operationId, input.providerId) });
  });
  return router;
}
