import { openDatabase } from './database.js';
const db=await openDatabase();
console.log('Mission Control database migration 001 applied.');
await db.close();
