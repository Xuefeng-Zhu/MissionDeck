import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import type { Database, Scope } from './database.js';
import { config } from './config.js';
export type Principal = Scope & { origin: string; tokenHash: string };
export type AuthenticatedRequest = Request & { principal: Principal };
export const digest = (value:string) => createHash('sha256').update(value).digest('hex');
export const equalSecret = (a:string,b:string) => timingSafeEqual(Buffer.from(digest(a)),Buffer.from(digest(b)));
export async function pairingCode(): Promise<string> {
  if(config.PAIRING_CODE) { if(config.PAIRING_CODE.length<24) throw new Error('PAIRING_CODE must contain at least 24 characters.'); return config.PAIRING_CODE; }
  await mkdir(config.dataDir,{recursive:true,mode:0o700});
  const file=resolve(config.dataDir,'pairing-code');
  try { return (await readFile(file,'utf8')).trim(); } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  const code=randomBytes(24).toString('hex');
  await writeFile(file,code+'\n',{mode:0o600,flag:'wx'});
  return code;
}
export function authMiddleware(db: Database) {
  return async(req:Request,res:Response,next:NextFunction) => {
    const token=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    if(!token) {res.status(401).json({error:'Pair this workspace to continue.',code:'unauthorized'});return;}
    const tokenHash=digest(token);
    const rows=await db.query<{owner_id:string;workspace_id:string;origin:string}>('SELECT owner_id,workspace_id,origin FROM sessions WHERE token_hash=$1 AND expires_at>now()', [tokenHash]);
    const row=rows.rows[0];
    if(!row || (req.headers.origin && row.origin!==req.headers.origin)) {res.status(401).json({error:'Session expired, revoked, or belongs to another origin.',code:'unauthorized'});return;}
    (req as AuthenticatedRequest).principal={ownerId:row.owner_id,workspaceId:row.workspace_id,origin:row.origin,tokenHash};next();
  };
}
export async function issueSession(db:Database,origin:string):Promise<string> {
  const token=randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions(token_hash,owner_id,workspace_id,origin,expires_at) VALUES($1,$2,$3,$4,$5)', [digest(token),'local-user','local-workspace',origin,new Date(Date.now()+24*3600_000).toISOString()]);
  return token;
}
