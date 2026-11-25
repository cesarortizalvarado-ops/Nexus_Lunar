import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

function collectPublicJsPaths(baseDir, currentDir = baseDir) {
  const results = [];
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const full = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPublicJsPaths(baseDir, full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push({
        fullPath: full,
        webPath: '/' + path.relative(baseDir, full).replaceAll(path.sep, '/'),
      });
    }
  }
  return results;
}

test('WEB UI ASSETS: HTML, CSS y módulos ES cumplen CSP estricta, sintaxis y endpoints reales', async () => {
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
    const publicRoot = path.resolve(process.cwd(), 'public');
    const jsAssets = [
      { fullPath: path.join(publicRoot, 'app.js'), webPath: '/app.js' },
      ...collectPublicJsPaths(publicRoot, path.join(publicRoot, 'js')),
    ];

    // Validar sintaxis node --check sobre app.js y todos los módulos bajo public/js/
    for (const asset of jsAssets) {
      execFileSync(process.execPath, ['--check', asset.fullPath], { stdio: 'pipe' });
    }

    const staticRoutes = [
      '/',
      '/styles.css',
      '/css/layout.css',
      '/css/views.css',
      ...jsAssets.map((a) => a.webPath),
    ];

    const fetched = await Promise.all(
      staticRoutes.map(async (route) => {
        const res = await fetch(`${baseUrl}${route}`);
        const text = await res.text();
        return { route, res, text };
      })
    );

    const byRoute = new Map(fetched.map((item) => [item.route, item]));

    for (const { route, res } of fetched) {
      assert.equal(res.status, 200, `Debe servir ${route} con HTTP 200`);
      assert.ok(res.headers.get('content-security-policy')?.includes("default-src 'self'"), `CSP faltante en ${route}`);
      assert.equal(res.headers.get('x-frame-options'), 'DENY', `X-Frame-Options faltante en ${route}`);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', `X-Content-Type-Options faltante en ${route}`);
    }

    const html = byRoute.get('/').text;
    const cssMain = byRoute.get('/styles.css').text;
    const cssLayout = byRoute.get('/css/layout.css').text;
    const cssViews = byRoute.get('/css/views.css').text;

    assert.ok(byRoute.has('/js/charts-svg.js'), 'Debe existir /js/charts-svg.js');
    assert.ok(byRoute.has('/js/voice-bridge.js'), 'Debe existir /js/voice-bridge.js');

    // 1. Verificar cero <script> inline (solo script modular local src="/app.js")
    const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    assert.equal(scriptTags.length, 1);
    assert.match(scriptTags[0][1], /src="\/app\.js"/i);
    assert.equal(scriptTags[0][2].trim(), '', 'No debe existir código JS inline dentro de <script>');

    // 2. Verificar presencia de shell de 3 columnas y botones clave
    assert.ok(html.includes('id="copilot-panel"'), 'Debe incluir panel derecho persistente de chat');
    assert.ok(html.includes('id="plan-sat-badge"'), 'Debe incluir badge destacado en Plan Semanal');
    assert.ok(html.includes('id="chat-voice-btn"'), 'Debe incluir botón de voz en chat');
    assert.ok(html.includes('id="chat-tts-toggle"'), 'Debe incluir toggle TTS en chat');

    // 3. Verificar cero manejadores inline (onclick, onchange, onsubmit) en HTML y todos los módulos JS
    assert.equal(/\son(click|change|submit)\s*=/i.test(html), false, 'HTML no debe tener atributos inline on*');
    for (const asset of jsAssets) {
      const code = byRoute.get(asset.webPath).text;
      assert.equal(/\son(click|change|submit)\s*=/i.test(code), false, `${asset.webPath} no debe generar atributos inline on*`);
    }

    // 4. Verificar cero CDNs o recursos externos en HTML y CSS
    assert.equal(/(?:src|href)=["']https?:\/\//i.test(html), false, 'HTML no debe enlazar URLs externas');
    assert.equal(/https?:\/\//i.test(cssMain), false, 'styles.css no debe importar recursos externos');
    assert.equal(/https?:\/\//i.test(cssLayout), false, 'css/layout.css no debe importar recursos externos');
    assert.equal(/https?:\/\//i.test(cssViews), false, 'css/views.css no debe importar recursos externos');

    // 4b. Verificar que helpers SVG nativos generan SVG accesible sin JS inline
    const chartsMod = await import('../public/js/charts-svg.js');
    const heatmapSvg = chartsMod.renderHabitsMoodHeatmap([
      { date: '2026-11-28', habits: { scheduled: 1, completed: 1, partial: 0, missed: 0, skipped: 0, unknown: 0, completionRate: 1 }, mood: { mood_score: 5, energy_level: 4 } },
      { date: '2026-11-29', habits: { scheduled: 1, completed: 0, partial: 0, missed: 0, skipped: 0, unknown: 1, completionRate: null }, mood: null },
    ]);
    assert.ok(heatmapSvg.includes('<svg') && heatmapSvg.includes('data-heatmap-date="2026-11-28"'));
    const sparkSvg = chartsMod.renderMoodEnergySparkline([
      { date: '2026-11-28', mood: { mood_score: 4, energy_level: 5 } },
      { date: '2026-11-29', mood: { mood_score: 3, energy_level: 4 } },
    ]);
    assert.ok(sparkSvg.includes('<svg') && sparkSvg.includes('<polyline'));
    const progSvg = chartsMod.renderProgressBarSvg(null, 'Sin tareas');
    assert.ok(progSvg.includes('<svg') && progSvg.includes('Sin tareas'));

    // 5. Verificar que el frontend modular consume endpoints reales clave
    const combinedJs = jsAssets.map((a) => byRoute.get(a.webPath).text).join('\n');
    const requiredEndpoints = [
      '/api/spaces/snapshot',
      '/api/spaces/catalog',
      '/api/planning/saturday/prepare',
      '/api/planning/saturday/approve',
      '/api/planning/baselines',
      '/api/dashboard/habits-mood',
      '/api/dashboard/projects-goals',
      '/api/dashboard/calendar',
      '/api/copilot/chat',
      '/api/copilot/conversations',
    ];
    for (const endpoint of requiredEndpoints) {
      assert.ok(combinedJs.includes(endpoint), `Frontend modular debe consumir ${endpoint}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    core.shutdown();
    dirs.cleanup();
  }
});
