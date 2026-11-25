import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(repoRoot, 'src');

function listJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function extractImports(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const specs = [];
  for (const m of txt.matchAll(/import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g)) {
    specs.push(m[1]);
  }
  return specs;
}

test('B06.3 — Guardia estática de fronteras arquitectónicas entre capas y ausencia de artefactos legacy 0.7.0', () => {
  // 1. Verificar retiro efectivo de los 11 módulos heredados 0.7.0 (DP-02)
  const retiredLegacyFiles = [
    'src/domain/calendar.js',
    'src/domain/record.js',
    'src/domain/work.js',
    'src/application/calendar-service.js',
    'src/application/habit-service.js',
    'src/application/record-service.js',
    'src/application/routine-service.js',
    'src/application/work-service.js',
    'src/infrastructure/backup-service.js',
    'src/infrastructure/database.js',
    'src/infrastructure/http-server.js',
  ];
  for (const rel of retiredLegacyFiles) {
    assert.equal(fs.existsSync(path.join(repoRoot, rel)), false, `El archivo heredado retirado no debe existir: ${rel}`);
  }

  // 2. src/shared/ depende exclusivamente de node:* o sí mismo
  for (const f of listJsFiles(path.join(srcRoot, 'shared'))) {
    for (const imp of extractImports(f)) {
      if (imp.startsWith('node:')) continue;
      const target = path.resolve(path.dirname(f), imp);
      assert.ok(target.startsWith(path.join(srcRoot, 'shared')), `src/shared no puede importar fuera de shared: ${f} -> ${imp}`);
    }
  }

  // 3. src/domain/ depende exclusivamente de node:*, src/domain/ o src/shared/ (cero imports a core/application/infrastructure/integration)
  for (const f of listJsFiles(path.join(srcRoot, 'domain'))) {
    for (const imp of extractImports(f)) {
      if (imp.startsWith('node:')) continue;
      const target = path.resolve(path.dirname(f), imp);
      const allowed = target.startsWith(path.join(srcRoot, 'domain')) || target.startsWith(path.join(srcRoot, 'shared'));
      assert.equal(allowed, true, `Violación de frontera en domain (${path.relative(repoRoot, f)} -> ${imp})`);
    }
  }

  // 4. src/application/ depende exclusivamente de node:*, src/application/, src/domain/ o src/shared/
  //    (cero imports estáticos a core/, infrastructure/, integration/ o interfaces/)
  for (const f of listJsFiles(path.join(srcRoot, 'application'))) {
    for (const imp of extractImports(f)) {
      if (imp.startsWith('node:')) continue;
      const target = path.resolve(path.dirname(f), imp);
      const allowed =
        target.startsWith(path.join(srcRoot, 'application')) ||
        target.startsWith(path.join(srcRoot, 'domain')) ||
        target.startsWith(path.join(srcRoot, 'shared'));
      assert.equal(allowed, true, `Violación de frontera en application (${path.relative(repoRoot, f)} -> ${imp})`);
    }
  }

  // 5. CLI y HTTP no invocan servicios de aplicación directamente: enrutan por executeOperation / executeOperationAsync
  for (const rel of ['src/interfaces/cli/nexus-cli.js', 'src/interfaces/http/http-server.js']) {
    const txt = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.ok(txt.includes('executeOperationAsync'), `${rel} debe despachar a través de executeOperationAsync`);
    const forbiddenServiceDirectCalls = [
      'core.taskService.',
      'core.projectService.',
      'core.goalService.',
      'core.memoryService.',
      'core.habitService.',
      'core.routineService.',
      'core.planningService.',
      'core.agendaService.',
      'core.backupService.',
      'core.restoreService.',
    ];
    for (const pattern of forbiddenServiceDirectCalls) {
      assert.equal(txt.includes(pattern), false, `${rel} no debe saltarse OperationDispatcher llamando a ${pattern}`);
    }
  }
});
