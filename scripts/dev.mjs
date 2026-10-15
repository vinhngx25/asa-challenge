// Starts the API and the web app together; stops both on Ctrl+C.
import { spawn } from 'node:child_process';

const procs = [
  ['api', ['run', 'dev', '-w', 'backend']],
  ['web', ['run', 'dev', '-w', 'frontend']],
].map(([name, args]) => {
  const p = spawn('npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const tag = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`[${name}] ${l}`));
  p.stdout.on('data', tag);
  p.stderr.on('data', tag);
  p.on('exit', (code) => {
    console.log(`[${name}] exited with ${code}`);
    procs.forEach((q) => q.kill());
    process.exit(code ?? 0);
  });
  return p;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));