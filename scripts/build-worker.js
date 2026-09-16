/* Bundle worker/index.js (+ lib/, data/*.json, qrcode core) into a single _worker.js for Cloudflare Pages. */
const path = require('path');
const esbuild = require('esbuild');
const ROOT = path.join(__dirname, '..');
const out = process.argv[2] || path.join(ROOT, '_site', '_worker.js');
esbuild.build({
  entryPoints: [path.join(ROOT, 'worker', 'index.js')], bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', outfile: out,
  mainFields: ['module', 'main'], conditions: ['workerd', 'worker', 'browser'], legalComments: 'none', minify: false, logLevel: 'warning',
}).then(() => console.log('built ' + path.relative(ROOT, out))).catch((e) => { console.error(e.message || e); process.exit(1); });
