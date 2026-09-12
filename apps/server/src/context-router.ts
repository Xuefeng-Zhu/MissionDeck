import {Router} from 'express';
import {z} from 'zod';
import {createHash,randomUUID} from 'node:crypto';
import type {MissionService} from './service.js';
import type {AuthenticatedRequest} from './auth.js';
import {HttpError} from './errors.js';
import {sanitizeSourceUrl} from '@mission/domain';
const scopedKey=(kind:string,scope:{ownerId:string;workspaceId:string},value:string)=>kind+':'+createHash('sha256').update(JSON.stringify([scope.ownerId,scope.workspaceId,value])).digest('hex');
const id=z.string().min(1).max(160).regex(/^[\w.:-]+$/);
const source=z.object({snapshotId:id,sourceUrl:z.string().max(2048),title:z.string().max(500),capturedAt:z.string().datetime(),contentHash:z.string().max(128).optional(),text:z.string().max(20000),truncated:z.boolean()}).strict();
export const contextRequestSchema=z.object({sessionId:id,requestId:id,sources:z.array(source).min(1).max(5),sharingMode:z.enum(['manual','automatic']),consented:z.literal(true)}).strict().superRefine((v,c)=>{if(v.sources.reduce((n,s)=>n+s.text.length,0)>50000)c.addIssue({code:'custom',message:'Select at most 50,000 characters per request.'});if(new Set(v.sources.map(s=>s.snapshotId)).size!==v.sources.length)c.addIssue({code:'custom',message:'Duplicate snapshot IDs.'});});
export function createContextRouter(service:MissionService){
 const router=Router();const db=service.db;
 router.post('/api/missions/:id/context',async(req,res)=>{
   const scope=(req as unknown as AuthenticatedRequest).principal;const missionId=id.parse(req.params.id);await service.get(missionId,scope);
   const input=contextRequestSchema.parse(req.body);const now=Date.now();
   for(const s of input.sources)if(Date.parse(s.capturedAt)>now+60000||Date.parse(s.capturedAt)<now-600000)throw new HttpError(409,'Source is stale; refresh the selected page.');
   const data={...input,missionId,sources:input.sources.map(s=>({...s,sourceUrl:sanitizeSourceUrl(s.sourceUrl),contentHash:createHash('sha256').update(s.text).digest('hex')})),expiresAt:new Date(now+600000).toISOString()};
   await db.transaction(async q=>{
     if(!(await q('SELECT token_hash FROM sessions WHERE token_hash=$1 AND expires_at>now()',[scope.tokenHash])).rows.length)throw new HttpError(401,'Session expired or revoked.');
     await q('DELETE FROM temporary_context WHERE expires_at <= now()');
     const revoked=await q('SELECT id FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4',[scopedKey('context-revoked',scope,input.sessionId),'context_revocation',scope.ownerId,scope.workspaceId]);
     if(revoked.rows.length)throw new HttpError(409,'Context session was revoked. Start a new session.');
     // Immutable request identity: a replay cannot silently substitute a new source set.
     const previous=await q('SELECT id FROM upgrade_records WHERE id=$1',[scopedKey('context-request',scope,input.requestId)]);
     if(previous.rows.length)throw new HttpError(409,'Request already frozen; use a new request ID.');
     await q('INSERT INTO upgrade_records(id,kind,owner_id,workspace_id,mission_id,revision,data) VALUES($1,$2,$3,$4,$5,1,$6)',[scopedKey('context-request',scope,input.requestId),'context_request',scope.ownerId,scope.workspaceId,missionId,JSON.stringify({expiresAt:data.expiresAt})]);
     await q('DELETE FROM temporary_context WHERE owner_id=$1 AND workspace_id=$2 AND mission_id=$3',[scope.ownerId,scope.workspaceId,missionId]);
     await q('INSERT INTO temporary_context(id,owner_id,workspace_id,mission_id,session_id,request_id,data,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),scope.ownerId,scope.workspaceId,missionId,input.sessionId,input.requestId,JSON.stringify(data),data.expiresAt]);
   });res.json(data);
 });
 router.get('/api/missions/:id/context',async(req,res)=>{
   const scope=(req as unknown as AuthenticatedRequest).principal;const missionId=id.parse(req.params.id);await service.get(missionId,scope);
   await db.query('DELETE FROM temporary_context WHERE expires_at<=now()');
   const rows=await db.query<{data:unknown}>('SELECT data FROM temporary_context WHERE owner_id=$1 AND workspace_id=$2 AND mission_id=$3 AND expires_at>now()',[scope.ownerId,scope.workspaceId,missionId]);res.json({context:rows.rows[0]?.data??null});
 });
 router.delete('/api/missions/:id/context/:sessionId',async(req,res)=>{
   const scope=(req as unknown as AuthenticatedRequest).principal;const missionId=id.parse(req.params.id);const sessionId=id.parse(req.params.sessionId);await service.get(missionId,scope);
   await db.transaction(async q=>{
     await q('DELETE FROM temporary_context WHERE owner_id=$1 AND workspace_id=$2 AND session_id=$3',[scope.ownerId,scope.workspaceId,sessionId]);
     await q('INSERT INTO upgrade_records(id,kind,owner_id,workspace_id,mission_id,revision,data) VALUES($1,$2,$3,$4,$5,1,$6) ON CONFLICT DO NOTHING',[scopedKey('context-revoked',scope,sessionId),'context_revocation',scope.ownerId,scope.workspaceId,missionId,JSON.stringify({revokedAt:new Date().toISOString()})]);
   });res.json({revoked:true,alreadyTransmittedDataRecallable:false,approvedArtifactsDeleted:false});
 });return router;
}
