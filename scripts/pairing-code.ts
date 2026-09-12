import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
// An explicit local command for the human operator. Server logs never contain the code.
console.log(await readFile(resolve('.data/pairing-code'), 'utf8'));
