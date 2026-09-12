import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from './config.js';
import { missionSchema, type Mission } from '@mission/domain';
export type Scope = { ownerId: string; workspaceId: string };
export type Query = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
export class Database {
  private gate: Promise<unknown> = Promise.resolve();
  constructor(public query: Query, private transactionImpl: <T>(fn: (query: Query) => Promise<T>) => Promise<T>, public close: () => Promise<void>) {}
  // PGlite has one connection. Serialize both local backends for identical transaction semantics.
  transaction<T>(fn: (query: Query) => Promise<T>): Promise<T> {
    const result = this.gate.then(() => this.transactionImpl(fn));
    this.gate = result.catch(() => undefined);
    return result;
  }
  async get(id: string, scope: Scope, q: Query = this.query): Promise<Mission | null> {
    const result = await q<{ data: Mission }>('SELECT data FROM missions WHERE id=$1 AND owner_id=$2 AND workspace_id=$3', [id, scope.ownerId, scope.workspaceId]);
    return result.rows[0] ? missionSchema.parse(result.rows[0].data) : null;
  }
  async list(scope: Scope): Promise<Mission[]> {
    const r = await this.query<{ data: Mission }>('SELECT data FROM missions WHERE owner_id=$1 AND workspace_id=$2 ORDER BY updated_at DESC', [scope.ownerId,scope.workspaceId]);
    return r.rows.map(row => missionSchema.parse(row.data));
  }
  async save(mission: Mission, q: Query): Promise<void> {
    const m = missionSchema.parse(mission);
    await q('INSERT INTO missions(id,owner_id,workspace_id,revision,data,updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,data=excluded.data,updated_at=excluded.updated_at', [m.id,m.ownerId,m.workspaceId,m.revision,JSON.stringify(m),m.updatedAt]);
    // Entity projections and aggregate are committed together; the aggregate is the read model.
    for(const collection of ['criteria','tasks','evidence','proposals','approvals','operations','artifacts','events'] as const) {
      for(const record of m[collection]) {
        const columns = ['id','mission_id','data']; const params:unknown[] = [record.id,m.id,JSON.stringify(record)];
        if(collection==='evidence') { columns.push('content_hash'); params.push((record as Mission['evidence'][number]).contentHash); }
        if(collection==='proposals') { columns.push('payload_hash','state'); params.push((record as Mission['proposals'][number]).payloadHash,(record as Mission['proposals'][number]).state); }
        if(collection==='approvals') { columns.push('proposal_id'); params.push((record as Mission['approvals'][number]).proposalId); }
        if(collection==='operations') { columns.push('idempotency_key','state'); params.push((record as Mission['operations'][number]).idempotencyKey,(record as Mission['operations'][number]).state); }
        const saved=await q(`INSERT INTO ${collection}(${columns.join(',')}) VALUES(${params.map((_,i)=>'$'+(i+1)).join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(c=>c!=='id'&&c!=='mission_id').map(c=>`${c}=excluded.${c}`).join(',')} WHERE ${collection}.mission_id=excluded.mission_id RETURNING id`,params);
        if(!saved.rows.length)throw new Error('Entity ID is already owned by another mission.');
      }
    }
  }
}
export async function openDatabase(options?: { memory?: boolean; path?: string }): Promise<Database> {
  let db: Database;
  if(config.DATABASE_MODE === 'postgres' && !options?.memory && !options?.path) {
    if(!config.DATABASE_URL) throw new Error('DATABASE_URL is required for postgres mode.');
    const pool = new pg.Pool({ connectionString:config.DATABASE_URL,max:4 });
    const query:Query = async (sql,params) => pool.query(sql,params);
    db = new Database(query,async fn => { const client=await pool.connect(); try { await client.query('BEGIN'); await client.query('SELECT pg_advisory_xact_lock(4318)'); const result=await fn(async(sql,params)=>client.query(sql,params)); await client.query('COMMIT'); return result; } catch(e) { await client.query('ROLLBACK');throw e; } finally {client.release();} },()=>pool.end());
  } else {
    if(!options?.memory) await mkdir(options?.path ?? resolve(config.dataDir,'postgres'),{recursive:true,mode:0o700});
    const local = new PGlite(options?.memory ? undefined : options?.path ?? resolve(config.dataDir,'postgres'));
    await local.waitReady;
    const query:Query = (sql,params) => local.query(sql,params);
    db = new Database(query,fn=>local.transaction(tx=>fn((sql,params)=>tx.query(sql,params))),()=>local.close());
  }
  await applyMigrations(db);
  return db;
}

/** Trusted repository migrations only. Each version and its statements commit atomically. */
export async function applyMigrations(db:Database,directory=new URL('../migrations/',import.meta.url)):Promise<void> {
  const files=(await readdir(directory)).filter(name=>/^\d{3,}_[a-z0-9_]+\.sql$/.test(name)).sort((a,b)=>Number(a.split('_')[0])-Number(b.split('_')[0]));
  const versions=new Set<number>();
  for(const file of files){const version=Number(file.split('_')[0]);if(versions.has(version))throw new Error(`Duplicate migration version ${version}`);versions.add(version);}
  await db.transaction(async q=>{await q('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');});
  for(const file of files){
    const version=Number(file.split('_')[0]);const sql=await readFile(new URL(file,directory),'utf8');
    await db.transaction(async q=>{
      if((await q('SELECT version FROM schema_migrations WHERE version=$1',[version])).rows.length)return;
      // These additive migrations contain ordinary DDL only, no procedural bodies.
      for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await q(statement);
      await q('INSERT INTO schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING',[version]);
    });
  }
}
