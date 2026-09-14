import type {Database, Query, Scope} from './database.js';
import {HttpError} from './errors.js';
export interface UpgradeRecord<T=unknown> {id:string;kind:string;missionId?:string|null;revision:number;data:T}
/** Small scoped local records, never a mailbox/document mirror. Call mutations inside db.transaction. */
export class UpgradeStore {
  constructor(public db:Database) {}
  async get<T=unknown>(id:string,kind:string,scope:Scope,q:Query=this.db.query):Promise<UpgradeRecord<T>> {
    const result=await q<{id:string;kind:string;mission_id:string|null;revision:number;data:T}>('SELECT id,kind,mission_id,revision,data FROM upgrade_records WHERE id=$1 AND kind=$2 AND owner_id=$3 AND workspace_id=$4',[id,kind,scope.ownerId,scope.workspaceId]);
    const row=result.rows[0];if(!row)throw new HttpError(404,'Record not found in this workspace.');
    return {id:row.id,kind:row.kind,missionId:row.mission_id,revision:row.revision,data:row.data};
  }
  async list<T=unknown>(kind:string,scope:Scope,missionId?:string):Promise<UpgradeRecord<T>[]> {
    const result=await this.db.query<{id:string;kind:string;mission_id:string|null;revision:number;data:T}>(`SELECT id,kind,mission_id,revision,data FROM upgrade_records WHERE kind=$1 AND owner_id=$2 AND workspace_id=$3${missionId?' AND mission_id=$4':''} ORDER BY updated_at DESC LIMIT 200`,[kind,scope.ownerId,scope.workspaceId,...(missionId?[missionId]:[])]);
    return result.rows.map(row=>({id:row.id,kind:row.kind,missionId:row.mission_id,revision:row.revision,data:row.data}));
  }
  async save<T>(record:UpgradeRecord<T>,scope:Scope,q:Query):Promise<void> {
    if(scope.ownerId.startsWith('demo-user:')){
      const live=await q('SELECT token_hash FROM sessions WHERE owner_id=$1 AND workspace_id=$2 AND expires_at>now() LIMIT 1',[scope.ownerId,scope.workspaceId]);
      if(!live.rows.length)throw new HttpError(401,'This demo session expired or was reset. Start a fresh session to continue.','unauthorized');
    }
    if(record.missionId&&!await this.db.get(record.missionId,scope,q))throw new HttpError(404,'Mission not found in this workspace.');
    const result=await q(`INSERT INTO upgrade_records(id,kind,owner_id,workspace_id,mission_id,revision,data) VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=now()
      WHERE upgrade_records.owner_id=excluded.owner_id AND upgrade_records.workspace_id=excluded.workspace_id AND upgrade_records.kind=excluded.kind AND upgrade_records.mission_id IS NOT DISTINCT FROM excluded.mission_id AND upgrade_records.revision=excluded.revision-1 RETURNING id`,[record.id,record.kind,scope.ownerId,scope.workspaceId,record.missionId??null,record.revision,JSON.stringify(record.data)]);
    if(!result.rows.length)throw new HttpError(409,'Record changed or belongs to another scope; refresh review.');
  }
}
