import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyMigrations,openDatabase,type Database} from './database.js';
import {UpgradeStore} from './upgrade-store.js';
let db:Database;afterEach(async()=>{await db?.close();});
it('applies additive versions once and rolls back a failed version',async()=>{
 db=await openDatabase({memory:true});expect((await db.query('SELECT version FROM schema_migrations ORDER BY version')).rows).toEqual([{version:1},{version:2}]);
 await applyMigrations(db);
 const directory=await mkdtemp(join(tmpdir(),'mission-migrations-'));
 try{await writeFile(join(directory,'003_test.sql'),'CREATE TABLE rollback_probe(id text); INVALID SQL;');await expect(applyMigrations(db,pathToFileURL(directory+'/'))).rejects.toThrow();expect((await db.query("SELECT tablename FROM pg_tables WHERE tablename='rollback_probe'")).rows).toEqual([]);expect((await db.query('SELECT version FROM schema_migrations WHERE version=3')).rows).toEqual([]);}finally{await rm(directory,{recursive:true,force:true});}
});
it('enforces record scope and optimistic revisions',async()=>{
 db=await openDatabase({memory:true});const store=new UpgradeStore(db);const a={ownerId:'a',workspaceId:'one'},b={ownerId:'a',workspaceId:'two'};
 const record={id:'routine-test',kind:'routine',revision:1,data:{state:'draft'}};
 await db.transaction(q=>store.save(record,a,q));await expect(store.get(record.id,'routine',b)).rejects.toThrow('not found');
 await expect(db.transaction(q=>store.save({...record,revision:2},b,q))).rejects.toThrow('changed');
 await db.transaction(q=>store.save({...record,revision:2,data:{state:'previewed'}},a,q));
 await expect(db.transaction(q=>store.save({...record,revision:2},a,q))).rejects.toThrow('changed');
 expect((await store.get<{state:string}>(record.id,'routine',a)).data.state).toBe('previewed');
});
