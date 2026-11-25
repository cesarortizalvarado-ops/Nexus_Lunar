import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createCoreHttpServer } from '../src/interfaces/http/http-server.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-webui-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('WEB UI ASSETS: HTML, CSS y JS se sirven con cabeceras seguras, cumplen CSP estricta y consumen endpoints reales', async () => {
  const dirs = makeTempDirs();
  const core = createNexusCore({
    dataDir: dirs.dataDir,
    backupDir: dirs.backupDir,
    timezone: 'America/Mexico_City',
  });
  const server = createCoreHttpServer(core);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const [resHtml, resCss, resJs] = await Promise.all([
      fetch(`${baseUrl}/`),
      fetch(`${baseUrl}/styles.css`),
      fetch(`${baseUrl}/app.js`),
    ]);

    assert.equal(resHtml.status, 200);
    assert.equal(resCss.status, 200);
    assert.equal(resJs.status, 200);

    for (const res of [resHtml, resCss, resJs]) {
      assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'self'"));
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    }

    const html = await resHtml.text();
    const css = await resCss.text();
    const js = await resJs.text();

    // 1. Verificar cero <script> inline (solo script externo local src="/app.js")
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.equal(scriptTags.length, 1);
    assert.match(scriptTags[0][1], /src="\/app\.js"/i);
    assert.equal(scriptTags[0][2].trim(), '', 'No debe existir código JS inline dentro de <script>');

    // 2. Verificar cero manejadores inline (onclick, onchange, onsubmit) en HTML y JS
    assert.equal(/\son(click|change|submit)\s*=/i.test(html), false, 'HTML no debe tener atributos inline on*');
    assert.equal(/\son(click|change|submit)\s*=/i.test(js), false, 'app.js no debe generar atributos inline on*');

    // 3. Verificar cero CDNs o recursos externos en HTML y CSS
    assert.equal(/(?:src|href)=["']https?:\/\//i.test(html), false, 'HTML no debe enlazar URLs externas');
    assert.equal(/https?:\/\//i.test(css), false, 'CSS no debe importar recursos externos');

    // 4. Verificar que app.js consume los endpoints reales del Bloque 5
    const requiredEndpoints = [
      '/api/spaces/snapshot',
      '/api/planning/saturday/prepare',
      '/api/planning/saturday/approve',
      '/api/planning/baselines',
      '/api/copilot/proposals',
    ];
    for (const endpoint of requiredEndpoints) {
      assert.ok(js.includes(endpoint), `app.js debe consumir el endpoint real ${endpoint}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    dirs.cleanup();
  }
});
