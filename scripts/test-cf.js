/* Smoke test the Cloudflare worker: build the real site, start `wrangler pages dev` with a local D1/R2, run scripts/smoke-test.js against it. Run: npm run test:cf */
const { spawn, execSync } = require('child_process'); const path = require('path'); const fs = require('fs'); const os = require('os');
const ROOT = path.join(__dirname, '..');
const PORT = parseInt(process.env.CF_PORT || '8790', 10), TOKENINFO_PORT = parseInt(process.env.TOKENINFO_PORT || '8765', 10);
const persist = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-cf-'));
execSync('bash scripts/build-site.sh', { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SITE_MODE: 'real', OUT: '_site' } });
console.log(process.env.NO_R2 ? '[test:cf] files stored in D1 (no R2 binding)' : '[test:cf] files stored in R2');
const bindings = { JWT_SECRET: 'test', TEST_MODE: '1', GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_TOKENINFO_URL: `http://127.0.0.1:${TOKENINFO_PORT}/tokeninfo`, PROMPTPAY_ID: '0812345678',
  // อีเมลผ่าน Microsoft Graph (stub ใน smoke-test: /ms/token + /ms/graph)
  MS_TENANT_ID: 'test-tenant', MS_CLIENT_ID: 'test-client', MS_CLIENT_SECRET: 'test-secret', MS_TOKEN_URL: `http://127.0.0.1:${TOKENINFO_PORT}/ms/token`, MS_GRAPH_URL: `http://127.0.0.1:${TOKENINFO_PORT}/ms/graph`, MAIL_FROM: 'JIANCHA Order <no-reply@jianchatea.com>', ORDER_DAY_OVERRIDE: '2026-09-18', RESET_ORDERS_AT: '2026-09-01 00:00' };
const args = ['wrangler', 'pages', 'dev', '_site', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--d1', 'DB=jc-order', ...(process.env.NO_R2 ? [] : ['--r2', 'FILES=jc-files']), '--compatibility-date=2026-09-01', '--log-level', 'warn'];
for (const [k, v] of Object.entries(bindings)) args.push('--binding', `${k}=${v}`);
const wr = spawn('npx', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let log = ''; wr.stdout.on('data', (d) => { log += d; }); wr.stderr.on('data', (d) => { log += d; });
const base = `http://127.0.0.1:${PORT}`;
const stop = () => { try { process.kill(-wr.pid, 'SIGTERM'); } catch (e) { /* gone */ } };
(async () => {
  let up = false;
  for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(base + '/api/stores')).ok; } catch (e) { /* not yet */ } }
  if (!up) { console.error('wrangler pages dev did not start:\n' + log); stop(); process.exit(1); }
  const t = spawn(process.execPath, [path.join(__dirname, 'smoke-test.js')], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, BASE_URL: base, TOKENINFO_PORT: String(TOKENINFO_PORT) } });
  t.on('exit', (code) => {
    stop();
    if (code) console.error('--- worker log (tail) ---\n' + log.split('\n').slice(-40).join('\n'));
    setTimeout(() => { fs.rmSync(persist, { recursive: true, force: true }); process.exit(code); }, 1500);
  });
})();
