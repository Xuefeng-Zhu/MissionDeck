import { spawn } from 'node:child_process';
const children = [spawn('pnpm', ['dev:server'], { stdio: 'inherit' }), spawn('pnpm', ['dev:extension'], { stdio: 'inherit' })];
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { children.forEach(c => c.kill(signal)); process.exit(0); });
children.forEach(c => c.on('exit', code => { if(code) { children.forEach(other => other.kill()); process.exit(code); } }));
