import { apiFetch, escapeHtml, showToast } from '../api.js';
import { state } from '../state.js';

function renderDoctorCard(report) {
  const badgeClass = report.status === 'OK' ? 'badge-ok' : report.status === 'WARN' ? 'badge-warn' : 'badge-err';
  const { storage, backups, baselines, libraries, ai } = report.checks;
  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div class="list-row">
        <span>Estado global del núcleo</span>
        <span class="badge ${badgeClass}">${escapeHtml(report.status)}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-box"><span>SQLITE</span><strong>v${escapeHtml(storage.schema_version)}</strong><small>${storage.ok ? 'Íntegro' : 'Error'}</small></div>
        <div class="stat-box"><span>BASELINES SHA-256</span><strong>${baselines.validCount}/${baselines.total}</strong><small>Corruptas: ${baselines.corruptedIds.length}</small></div>
        <div class="stat-box"><span>RECETAS / INSUMOS</span><strong>${libraries.recipesCount} / ${libraries.inventoryProductsCount}</strong><small>Respaldos: ${backups.count}</small></div>
        <div class="stat-box"><span>IA / OLLAMA</span><strong>${escapeHtml(ai.mode)}</strong><small>${ai.available ? `${ai.models.length} modelos` : 'Modo determinista activo'}</small></div>
      </div>
      ${
        report.recommendations.length > 0
          ? `
        <div class="list-stack">
          ${report.recommendations.map((rec) => `<div class="alert-banner warn"><span>${escapeHtml(rec)}</span></div>`).join('')}
        </div>
      `
          : '<div class="alert-banner ok"><span>Todas las verificaciones operativas están listas.</span></div>'
      }
    </div>
  `;
}

export async function renderSystemView(contentEl) {
  const [storageHealth, modules, backups] = await Promise.all([
    apiFetch('/api/health/storage'),
    apiFetch('/api/modules'),
    apiFetch('/api/backups'),
  ]);
  state.storageHealth = storageHealth;
  state.modules = modules || [];
  state.backups = backups || [];

  const storageOk = Boolean(
    storageHealth.ok ??
      (storageHealth.integrity?.ok && storageHealth.files_integrity?.ok && !storageHealth.recovery?.recovery_mode)
  );
  const schemaVersion =
    storageHealth.schema_version ??
    storageHealth.metadata?.schema_version ??
    storageHealth.migrations?.current_version ??
    state.health?.schema_version ??
    '-';

  const ollamaStatus = state.health?.ollama_configured
    ? `Configurado (${state.health.ollama_model || 'modelo'})`
    : 'No configurado (Determinista Local)';

  contentEl.innerHTML = `
    <article class="card">
      <div class="card-head">
        <h2>Estado del Núcleo Local</h2>
        <span class="badge ${storageOk ? 'badge-ok' : 'badge-err'}">${storageOk ? 'Almacenamiento Íntegro' : 'Revisar Almacenamiento'}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-box"><span>ESQUEMA SQLITE</span><strong>v${escapeHtml(schemaVersion)}</strong><small>Integridad: ${escapeHtml(storageHealth.integrity?.ok ? 'OK' : 'WARN')}</small></div>
        <div class="stat-box"><span>ZONA HORARIA</span><strong class="mono">${escapeHtml(state.health?.timezone || 'Local')}</strong><small>Modo loopback estricto</small></div>
        <div class="stat-box"><span>MÓDULOS ACTIVOS</span><strong>${state.modules.filter((m) => m.status === 'AVAILABLE').length}/${state.modules.length}</strong><small>Local-first</small></div>
        <div class="stat-box"><span>OLLAMA / COPILOTO</span><strong>${escapeHtml(state.health?.ollama_configured ? 'Configurado' : 'Offline')}</strong><small>${escapeHtml(ollamaStatus)}</small></div>
      </div>
    </article>

    <div class="grid-2">
      <article class="card">
        <div class="card-head">
          <div>
            <h3>Diagnóstico Operativo (Doctor)</h3>
            <small>Verifica SQLite v${escapeHtml(schemaVersion)}, firmas SHA-256, bibliotecas, respaldos y sonda Ollama</small>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="run-doctor-btn">Ejecutar Diagnóstico (Doctor)</button>
        </div>
        ${state.doctorReport ? renderDoctorCard(state.doctorReport) : '<small style="color:var(--text-secondary);">Ejecuta el diagnóstico para verificar el estado integral del núcleo.</small>'}
      </article>

      <article class="card">
        <div class="card-head">
          <div>
            <h3>Módulos del Núcleo (${state.modules.length})</h3>
            <small>Estado de disponibilidad y registro de capacidades</small>
          </div>
        </div>
        <div class="list-stack">
          ${state.modules
            .map(
              (m) => `
            <div class="list-row">
              <span><strong>${escapeHtml(m.name || m.module_id)}</strong> <small class="mono" style="color:var(--text-muted);">${escapeHtml(m.module_id)}</small></span>
              <span class="badge ${m.status === 'AVAILABLE' ? 'badge-ok' : 'badge-warn'}">${escapeHtml(m.status)}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <h3>Respaldos Locales (${state.backups.length})</h3>
        <button type="button" class="btn btn-primary btn-sm" id="system-create-backup-btn">Crear Respaldo Local</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Motivo</th><th>Esquema</th><th>Fecha</th></tr></thead>
          <tbody>
            ${
              state.backups
                .slice(0, 12)
                .map(
                  (b) => `
              <tr>
                <td class="mono">${escapeHtml(b.id)}</td>
                <td>${escapeHtml(b.reason)}</td>
                <td>v${escapeHtml(b.schema_version)}</td>
                <td class="mono">${escapeHtml(b.created_at)}</td>
              </tr>
            `
                )
                .join('') || '<tr><td colspan="4">Sin respaldos registrados.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </article>
  `;
}

export async function handleSystemClick(e, rerender) {
  if (e.target.id === 'system-create-backup-btn') {
    const bkp = await apiFetch('/api/backups', { method: 'POST', body: JSON.stringify({ reason: 'web-system' }) });
    showToast(`Respaldo ${bkp.id} creado.`, { type: 'ok' });
    await rerender();
    return true;
  }

  if (e.target.id === 'run-doctor-btn') {
    const report = await apiFetch('/api/system/doctor');
    state.doctorReport = report;
    showToast(`Diagnóstico Doctor completado (${report.status}).`, { type: report.status === 'ERROR' ? 'err' : 'ok' });
    await rerender();
    return true;
  }

  return false;
}
