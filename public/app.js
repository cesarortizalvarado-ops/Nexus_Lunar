const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const EXECUTION_STATUSES = [
  'completed',
  'partial',
  'postponed',
  'interrupted',
  'blocked',
  'cancelled',
  'missed_with_reason',
  'off_schedule',
  'unconfirmed',
];

const STANDARD_EXERCISES = [
  { id: 'ex-walk-brisk', name: 'Caminata rápida (30m)', defaultDays: [1, 2, 3, 4, 5], defaultHour: 6.5, duration: 30 },
  { id: 'ex-weightlifting-moderate', name: 'Pesas intensidad media (40m)', defaultDays: [1, 3, 5], defaultHour: 18.5, duration: 40 },
  { id: 'ex-stationary-bike', name: 'Bicicleta estática (30m)', defaultDays: [2, 4], defaultHour: 7.5, duration: 30 },
  { id: 'ex-mobility-stretch', name: 'Movilidad y estiramiento (20m)', defaultDays: [0, 6], defaultHour: 8.5, duration: 20 },
];

const CLINICAL_FIELD_LABELS = [
  ['fastingGlucose', 'Glucosa en ayunas (mg/dL)'],
  ['totalCholesterol', 'Colesterol total (mg/dL)'],
  ['triglycerides', 'Triglicéridos (mg/dL)'],
  ['ldlCholesterol', 'Colesterol LDL (mg/dL)'],
  ['hdlCholesterol', 'Colesterol HDL (mg/dL)'],
  ['systolicPressure', 'Presión sistólica (mmHg)'],
  ['diastolicPressure', 'Presión diastólica (mmHg)'],
];

const VIEW_META = {
  week: { label: 'SEMANA ACTIVA Y BASELINE INMUTABLE', title: 'Semana Activa y Baseline Inmutable' },
  saturday: { label: 'REVISIÓN DEL SÁBADO Y APROBACIÓN', title: 'Revisión del Sábado y Aprobación' },
  spaces: { label: 'ESPACIOS ESPECIALIZADOS', title: 'Espacios Especializados' },
  copilot: { label: 'COPILOTO SEGURO', title: 'Copiloto Seguro y Propuestas' },
  system: { label: 'NÚCLEO · CAPTURA RÁPIDA · RESPALDOS', title: 'Núcleo, Captura Rápida y Respaldos' },
};

const state = {
  currentView: 'week',
  health: null,
  storageHealth: null,
  modules: [],
  snapshot: null,
  baselines: [],
  selectedBaselineId: null,
  baselineDetail: null,
  saturdayReview: null,
  copilotQueue: [],
  copilotRejected: [],
  copilotMode: null,
  goals: [],
  tasks: [],
  habits: [],
  backups: [],
  draftEmployments: null,
  draftCommitments: null,
};

const contentEl = document.getElementById('view-content');
const sectionNameEl = document.getElementById('section-name');
const pageTitleEl = document.getElementById('page-title');
const healthChipTextEl = document.getElementById('health-chip-text');
const sidebarStatusDotEl = document.getElementById('sidebar-status-dot');
const sidebarStatusTextEl = document.getElementById('sidebar-status-text');
const footerVersionEl = document.getElementById('footer-version');
const toastContainerEl = document.getElementById('toast-container');

function escapeHtml(val) {
  return String(val ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatHour(decimalHour) {
  const h = Math.floor(Number(decimalHour));
  const m = Math.round((Number(decimalHour) - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getNextSundayIso() {
  const now = new Date();
  const day = now.getDay();
  const offset = day === 0 ? 7 : 7 - day;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function showToast(message, { type = 'info', remediation = null } = {}) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const titleEl = document.createElement('div');
  titleEl.textContent = message;
  toast.appendChild(titleEl);

  if (remediation) {
    const subEl = document.createElement('small');
    subEl.textContent = remediation;
    toast.appendChild(subEl);
  }

  toastContainerEl.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 5500);
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errObj = body?.error ?? body?.errors?.[0] ?? {};
    const err = new Error(errObj.description ?? `Error HTTP ${res.status}`);
    err.remediation = errObj.remediation ?? null;
    throw err;
  }
  return body.data !== undefined ? body.data : body;
}

async function refreshGlobalStatus() {
  try {
    const health = await apiFetch('/health');
    state.health = health;
    healthChipTextEl.textContent = `v${health.schema_version} · ${health.system_status}`;
    sidebarStatusDotEl.className = 'status-dot';
    sidebarStatusTextEl.textContent = `Núcleo ${health.system_status}`;
    footerVersionEl.textContent = `${health.version} · esquema v${health.schema_version} · ${health.timezone}`;
  } catch (err) {
    sidebarStatusDotEl.className = 'status-dot err';
    sidebarStatusTextEl.textContent = 'Núcleo sin conexión';
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
}

function switchView(viewName) {
  if (!VIEW_META[viewName]) return;
  state.currentView = viewName;
  const meta = VIEW_META[viewName];
  sectionNameEl.textContent = meta.label;
  pageTitleEl.textContent = meta.title;
  contentEl.setAttribute('aria-labelledby', `tab-${viewName}`);

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const active = tab.dataset.view === viewName;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });

  renderCurrentView();
}

async function renderWeekView() {
  state.baselines = await apiFetch('/api/planning/baselines');
  if (state.baselines.length === 0) {
    state.selectedBaselineId = null;
    state.baselineDetail = null;
    contentEl.innerHTML = `
      <div class="empty-state">
        <h3>Aún no hay una Baseline semanal sellada</h3>
        <p>Configura tu perfil en Espacios Especializados y prepara la semana en Revisión del Sábado.</p>
        <div class="topbar-actions" style="justify-content:center;margin-top:12px;">
          <button type="button" class="btn btn-primary" data-jump-view="saturday">Ir a Revisión del Sábado</button>
          <button type="button" class="btn btn-secondary" data-jump-view="spaces">Configurar Espacios</button>
        </div>
      </div>
    `;
    return;
  }

  if (!state.selectedBaselineId || !state.baselines.some((b) => b.baselineId === state.selectedBaselineId)) {
    state.selectedBaselineId = state.baselines[0].baselineId;
  }

  state.baselineDetail = await apiFetch(`/api/planning/baselines/${encodeURIComponent(state.selectedBaselineId)}`);
  const { baseline, executionLog, revisionsLog, analysis } = state.baselineDetail;

  const latestStatusByBlock = new Map();
  for (const entry of executionLog) {
    latestStatusByBlock.set(entry.blockId, entry);
  }

  const actionableBlocks = [];
  for (const day of baseline.plan.dailySchedules) {
    for (const b of day.blocks) {
      if (b.category !== 'sleep') actionableBlocks.push(b);
    }
  }

  const pct = Math.round((analysis.confirmedCompletionRate || 0) * 100);
  const shortHash = String(baseline.integrityHash || '').slice(0, 16);

  contentEl.innerHTML = `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>Baseline Sellada</h2>
          <small class="text-secondary">Plan inmutable protegido con firma criptográfica SHA-256</small>
        </div>
        <label class="field" style="min-width:250px;">
          <span>Seleccionar semana sellada</span>
          <select id="baseline-selector">
            ${state.baselines.map((b) => `<option value="${escapeHtml(b.baselineId)}" ${b.baselineId === baseline.baselineId ? 'selected' : ''}>${escapeHtml(b.baselineId)} (${escapeHtml(b.weekStartDate || '-')})</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="stats-grid">
        <div class="stat-box">
          <span>ID / SEMANA</span>
          <strong class="mono">${escapeHtml(baseline.baselineId)}</strong>
          <small>Inicio: ${escapeHtml(baseline.plan.weekStartDate)}</small>
        </div>
        <div class="stat-box">
          <span>SELLO SHA-256</span>
          <strong class="mono" title="${escapeHtml(baseline.integrityHash)}">${escapeHtml(shortHash)}…</strong>
          <small><span class="badge badge-ok">INMUTABLE</span> · ${escapeHtml(baseline.approvedAt.slice(0, 10))}</small>
        </div>
        <div class="stat-box">
          <span>CUMPLIMIENTO CONFIRMADO</span>
          <strong>${pct}%</strong>
          <small>${analysis.statusCounts.completed} completados de ${analysis.confirmedBlocks} confirmados</small>
        </div>
        <div class="stat-box">
          <span>BLOQUES SIN CONFIRMAR</span>
          <strong>${analysis.unconfirmedBlocks}</strong>
          <small>Revisiones registradas: ${revisionsLog.length}</small>
        </div>
      </div>
    </article>

    <section class="week-grid" aria-label="Calendario semanal de 7 días">
      ${baseline.plan.dailySchedules.map((day) => {
        const nut = day.nutrition;
        const mealText = nut?.mealPlan?.meals
          ? `${nut.mealPlan.meals.breakfast?.name ?? ''} / ${nut.mealPlan.meals.lunch?.name ?? ''} / ${nut.mealPlan.meals.dinner?.name ?? ''}`
          : (nut?.hasValidMealPlan ? 'Menú asignado' : 'Sin menú asignado');
        return `
          <article class="day-column">
            <div class="day-header">
              <h3>${escapeHtml(DAY_NAMES[day.dayOfWeek] ?? `Día ${day.dayOfWeek}`)}</h3>
              <div class="day-nutrition">
                <div>Meta: <strong>${nut?.targetCalories ?? '-'} kcal</strong> · Ejercicio: <strong>${day.exerciseCaloriesBurned ?? 0} kcal</strong></div>
                <div>${escapeHtml(mealText)}</div>
              </div>
            </div>
            <div class="block-list">
              ${day.blocks.map((block) => {
                const exec = latestStatusByBlock.get(block.id);
                const status = exec ? exec.status : 'unconfirmed';
                const isSleep = block.category === 'sleep';
                return `
                  <div class="block-item cat-${escapeHtml(block.category)}" data-block-id="${escapeHtml(block.id)}">
                    <div class="block-meta">
                      <span class="mono">${formatHour(block.startHour)}–${formatHour(block.endHour)}</span>
                      <span class="badge badge-${escapeHtml(status)}">${escapeHtml(block.category)} · ${escapeHtml(status)}</span>
                    </div>
                    <div class="block-title">${escapeHtml(block.title)}</div>
                    ${exec?.reason ? `<small class="mono">Motivo: ${escapeHtml(exec.reason)}</small>` : ''}
                    ${isSleep ? '' : `
                      <div class="block-controls">
                        <div class="block-controls-row">
                          <select class="exec-status-select" data-block-id="${escapeHtml(block.id)}" aria-label="Estado de ${escapeHtml(block.title)}">
                            ${EXECUTION_STATUSES.map((st) => `<option value="${st}" ${st === status ? 'selected' : ''}>${st}</option>`).join('')}
                          </select>
                          <button type="button" class="btn btn-secondary btn-sm exec-save-btn" data-block-id="${escapeHtml(block.id)}">Registrar</button>
                        </div>
                        <input type="text" class="exec-reason-input ${status === 'missed_with_reason' ? 'reason-required' : ''}" data-block-id="${escapeHtml(block.id)}" placeholder="${status === 'missed_with_reason' ? 'Motivo obligatorio...' : 'Motivo opcional...'}" value="${escapeHtml(exec?.reason ?? '')}">
                      </div>
                    `}
                  </div>
                `;
              }).join('')}
            </div>
          </article>
        `;
      }).join('')}
    </section>

    <details class="collapsible">
      <summary>Registrar Reprogramación Autorizada (preserva intacta la baseline original)</summary>
      <form id="revision-form" style="margin-top:12px;">
        <p style="margin:0 0 10px;font-size:12px;color:var(--text-secondary);">La baseline original sellada permanece inmutable; esta acción registra un ajuste trazable en el historial de revisiones.</p>
        <div class="field-row">
          <label class="field">
            <span>Bloque original</span>
            <select name="originalBlockId" required>
              ${actionableBlocks.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(DAY_NAMES[b.dayOfWeek])} ${formatHour(b.startHour)} · ${escapeHtml(b.title)}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Nuevo día</span>
            <select name="newDayOfWeek">
              ${DAY_NAMES.map((name, idx) => `<option value="${idx}">${name}</option>`).join('')}
            </select>
          </label>
          <label class="field">
            <span>Hora inicio (0–24)</span>
            <input type="number" name="newStartHour" step="0.25" min="0" max="23.75" value="19" required>
          </label>
          <label class="field">
            <span>Hora fin (0–24)</span>
            <input type="number" name="newEndHour" step="0.25" min="0.25" max="24" value="20" required>
          </label>
        </div>
        <div class="field-row" style="margin-top:10px;">
          <label class="field">
            <span>Motivo de reprogramación</span>
            <input type="text" name="reason" required placeholder="Ej. Movido por lluvia o reunión imprevista">
          </label>
        </div>
        <div style="margin-top:12px;">
          <button type="submit" class="btn btn-primary btn-sm">Registrar Reprogramación</button>
        </div>
      </form>
      ${revisionsLog.length > 0 ? `
        <div class="list-stack" style="margin-top:12px;">
          ${revisionsLog.map((rev) => `
            <div class="list-row">
              <span><strong>${escapeHtml(rev.originalBlockId)}</strong> → ${escapeHtml(rev.reason)}</span>
              <small class="mono">${rev.newWindow ? `${DAY_NAMES[rev.newWindow.dayOfWeek]} ${formatHour(rev.newWindow.startHour)}–${formatHour(rev.newWindow.endHour)}` : ''}</small>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </details>
  `;
}

async function renderSaturdayView() {
  state.baselines = await apiFetch('/api/planning/baselines');
  const defaultNextSunday = getNextSundayIso();
  const review = state.saturdayReview;

  contentEl.innerHTML = `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>Preparar Borrador Semanal del Sábado</h2>
          <small>Cierre analítico, auditoría de espacios y cálculo de menú/despensa determinista</small>
        </div>
      </div>
      <form id="saturday-prepare-form">
        <div class="field-row">
          <label class="field">
            <span>Inicio de semana (YYYY-MM-DD)</span>
            <input type="date" name="nextWeekStartDate" required value="${escapeHtml(review?.nextWeekDraft?.weekStartDate ?? defaultNextSunday)}">
          </label>
          <label class="field">
            <span>Presupuesto semanal de despensa ($)</span>
            <input type="number" name="weeklyGroceryBudget" min="0" step="10" required value="${escapeHtml(review?.nextWeekDraft?.sundayPrep?.pantryReport?.weeklyGroceryBudget ?? 1200)}">
          </label>
          <label class="field">
            <span>Baseline previa (opcional)</span>
            <select name="previousBaselineId">
              <option value="">Ninguna</option>
              ${state.baselines.map((b) => `<option value="${escapeHtml(b.baselineId)}">${escapeHtml(b.baselineId)} (${escapeHtml(b.weekStartDate || '-')})</option>`).join('')}
            </select>
          </label>
        </div>

        <div style="margin-top:14px;">
          <div class="eyebrow" style="margin-bottom:8px;">RUTINAS DE EJERCICIO ESTÁNDAR</div>
          <div class="list-stack">
            ${STANDARD_EXERCISES.map((ex) => `
              <div class="list-row">
                <label class="checkbox-inline">
                  <input type="checkbox" class="sat-ex-check" data-ex-id="${ex.id}" ${ex.id === 'ex-walk-brisk' ? 'checked' : ''}>
                  <span><strong>${escapeHtml(ex.name)}</strong></span>
                </label>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <label class="field" style="width:140px;">
                    <span>Días (0=Dom..6=Sáb)</span>
                    <input type="text" class="sat-ex-days" data-ex-id="${ex.id}" value="${ex.defaultDays.join(',')}">
                  </label>
                  <label class="field" style="width:110px;">
                    <span>Hora (decimal)</span>
                    <input type="number" class="sat-ex-hour" data-ex-id="${ex.id}" step="0.25" min="5" max="22" value="${ex.defaultHour}">
                  </label>
                  <label class="field" style="width:95px;">
                    <span>Minutos</span>
                    <input type="number" class="sat-ex-dur" data-ex-id="${ex.id}" min="10" max="180" value="${ex.duration}">
                  </label>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div style="margin-top:14px;">
          <button type="submit" class="btn btn-primary">Generar Borrador del Sábado</button>
        </div>
      </form>
    </article>

    ${review ? renderSaturdayReviewResult(review) : ''}
  `;
}

function renderSaturdayReviewResult(review) {
  const draft = review.nextWeekDraft;
  const pantry = draft.sundayPrep?.pantryReport;
  const prev = review.previousWeekSummary;

  return `
    ${prev ? `
      <article class="card">
        <div class="card-head">
          <h3>Cierre de Semana Previa (${escapeHtml(prev.baselineId)})</h3>
          <span class="badge badge-accent">${Math.round((prev.confirmedCompletionRate || 0) * 100)}% completado</span>
        </div>
        <p style="margin:0 0 8px;">Bloques confirmados: <strong>${prev.confirmedBlocks}/${prev.totalTrackableBlocks}</strong> · Sin confirmar: <strong>${prev.unconfirmedBlocks}</strong></p>
        ${prev.documentedFrictionReasons.length > 0 ? `
          <div class="list-stack">
            ${prev.documentedFrictionReasons.map((f) => `
              <div class="list-row">
                <span>Fricción: <strong>${escapeHtml(f.reason)}</strong></span>
                <span class="badge badge-warn">${f.count}x</span>
              </div>
            `).join('')}
          </div>
        ` : '<small>Sin fricciones registradas en la semana previa.</small>'}
      </article>
    ` : ''}

    <article class="card">
      <div class="card-head">
        <h3>Puntos a Confirmar (${review.pendingQuestions.length})</h3>
        <span class="badge ${review.pendingQuestions.length > 0 ? 'badge-warn' : 'badge-ok'}">${review.pendingQuestions.length > 0 ? 'Requiere revisión' : 'Sin alertas'}</span>
      </div>
      ${review.pendingQuestions.length > 0 ? `
        <div class="list-stack">
          ${review.pendingQuestions.map((q) => `
            <div class="alert-banner ${q.severity === 'HIGH' || q.severity === 'CRITICAL' ? 'err' : 'warn'}">
              <span><strong>[${escapeHtml(q.severity)}]</strong> ${escapeHtml(q.question)}</span>
              <span class="badge badge-${escapeHtml(q.severity)}">${escapeHtml(q.category)}</span>
            </div>
          `).join('')}
        </div>
      ` : '<p>No hay conflictos ni pagos omitidos pendientes.</p>'}
    </article>

    <div class="grid-2">
      <article class="card">
        <div class="card-head">
          <h3>Preparación Dominical — Despensa</h3>
          <span class="badge ${pantry?.isWithinBudget ? 'badge-ok' : 'badge-err'}">Costo: $${pantry?.estimatedTotalCost ?? 0} / $${pantry?.weeklyGroceryBudget ?? 0}</span>
        </div>
        ${pantry?.budgetAlert ? `<div class="alert-banner err" style="margin-bottom:10px;"><span>${escapeHtml(pantry.budgetAlert.message)}</span></div>` : ''}
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Ingrediente</th><th>Por comprar</th><th>Unidad</th><th>Costo est.</th></tr>
            </thead>
            <tbody>
              ${(pantry?.shoppingList || []).map((item) => `
                <tr>
                  <td>${escapeHtml(item.itemName)}</td>
                  <td class="mono">${escapeHtml(item.quantityToBuy)}</td>
                  <td>${escapeHtml(item.unit)}</td>
                  <td class="mono">${item.estimatedCost !== null ? `$${item.estimatedCost}` : 'N/D'}</td>
                </tr>
              `).join('') || '<tr><td colspan="4">Despensa cubierta o sin recetas en biblioteca.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <div class="card-head">
          <h3>Checklist de Compromisos Recurrentes</h3>
        </div>
        <div class="list-stack">
          ${(draft.sundayPrep?.recurringCommitmentsChecklist || []).map((c) => `
            <div class="list-row">
              <span><strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.frequency)})</span>
              <span class="mono">$${escapeHtml(c.amount)}</span>
            </div>
          `).join('') || '<p>Sin compromisos recurrentes registrados.</p>'}
        </div>
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <h3>Vista Previa de los 7 Días</h3>
        <span class="badge badge-accent">Hard conflicts: ${draft.hardConflicts.length}</span>
      </div>
      <div class="week-grid">
        ${draft.dailySchedules.map((day) => `
          <div class="day-column">
            <div class="day-header">
              <h3>${escapeHtml(DAY_NAMES[day.dayOfWeek])}</h3>
              <div class="day-nutrition">${day.nutrition?.targetCalories ?? '-'} kcal · Ej: ${day.exerciseCaloriesBurned} kcal</div>
            </div>
            <div class="block-list">
              ${day.blocks.map((b) => `
                <div class="block-item cat-${escapeHtml(b.category)}">
                  <div class="block-meta"><span class="mono">${formatHour(b.startHour)}–${formatHour(b.endHour)}</span><span>${escapeHtml(b.category)}</span></div>
                  <div class="block-title">${escapeHtml(b.title)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        `).join('')}
      </div>
      <details class="collapsible" style="margin-top:14px;">
        <summary>Ver Briefing Determinista Completo (Markdown)</summary>
        <pre class="markdown-box">${escapeHtml(review.briefingMarkdown || '')}</pre>
      </details>
    </article>

    <div class="approval-bar">
      <label class="checkbox-inline">
        <input type="checkbox" id="approve-confirm-checkbox">
        <span>Revisé conflictos, menú y compromisos; autorizo sellar esta semana como Baseline inmutable</span>
      </label>
      <button type="button" class="btn btn-primary" id="approve-seal-btn" disabled>Aprobar y Sellar Baseline</button>
    </div>
  `;
}

async function renderSpacesView() {
  state.snapshot = await apiFetch('/api/spaces/snapshot');
  const snap = state.snapshot;

  if (!snap.profile) {
    contentEl.innerHTML = `
      <article class="card">
        <div class="card-head">
          <div>
            <h2>Inicialización de Perfil Personal</h2>
            <small>Registra tus datos biométricos, fuente de ingresos inicial y compromiso base para habilitar el planificador.</small>
          </div>
        </div>
        <form id="init-profile-form">
          <div class="field-row">
            <label class="field"><span>Fecha de nacimiento</span><input type="date" name="birthDate" required value="1990-01-01"></label>
            <label class="field"><span>Altura (cm)</span><input type="number" name="heightCm" required min="100" max="250" value="170"></label>
            <label class="field"><span>Peso actual (kg)</span><input type="number" name="currentWeightKg" required min="30" max="300" step="0.1" value="75"></label>
            <label class="field"><span>Sexo biológico</span><select name="sex"><option value="male">male</option><option value="female">female</option></select></label>
          </div>
          <div class="field-row" style="margin-top:12px;">
            <label class="field"><span>Empleo inicial</span><input type="text" name="empTitle" required value="Trabajo Principal"></label>
            <label class="field"><span>Ingreso quincenal ($)</span><input type="number" name="empAmount" required min="0" value="6000"></label>
            <label class="field"><span>Compromiso inicial</span><input type="text" name="commName" required value="Internet"></label>
            <label class="field"><span>Monto mensual ($)</span><input type="number" name="commAmount" required min="1" value="500"></label>
          </div>
          <div style="margin-top:14px;">
            <button type="submit" class="btn btn-primary">Guardar Perfil Inicial</button>
          </div>
        </form>
      </article>
    `;
    return;
  }

  const profile = snap.profile;
  state.draftEmployments = structuredClone(profile.employments || (profile.employment ? [profile.employment] : []));
  state.draftCommitments = structuredClone(profile.recurringCommitments || []);

  const latestLab = snap.latestClinicalPanel;
  const fresh = snap.biometricFreshness;

  contentEl.innerHTML = `
    <div class="grid-2">
      <article class="card">
        <div class="card-head">
          <h3>Biometría</h3>
          <span class="badge ${fresh?.isStale ? 'badge-warn' : 'badge-ok'}">${fresh?.daysSinceUpdate !== null ? `${fresh.daysSinceUpdate} días desde actualización` : 'Sin fecha'}</span>
        </div>
        <div class="stats-grid" style="margin-bottom:12px;">
          <div class="stat-box"><span>PESO ACTUAL</span><strong>${escapeHtml(profile.biometrics.currentWeightKg)} kg</strong></div>
          <div class="stat-box"><span>ALTURA</span><strong>${escapeHtml(profile.biometrics.heightCm)} cm</strong></div>
          <div class="stat-box"><span>NACIMIENTO</span><strong class="mono">${escapeHtml(profile.biometrics.birthDate)}</strong></div>
        </div>
        <form id="quick-weight-form" class="field-row" style="align-items:end;">
          <label class="field">
            <span>Actualizar peso (kg)</span>
            <input type="number" name="currentWeightKg" step="0.1" min="30" max="300" required value="${escapeHtml(profile.biometrics.currentWeightKg)}">
          </label>
          <button type="submit" class="btn btn-primary">Actualizar Peso</button>
        </form>
      </article>

      <article class="card">
        <div class="card-head">
          <h3>Laboratorio Clínico</h3>
          <span class="badge badge-accent">${latestLab ? `Último: ${escapeHtml(String(latestLab.recordedAt || '').slice(0, 10))}` : 'Sin paneles'}</span>
        </div>
        <form id="clinical-panel-form">
          <div class="field-row">
            ${CLINICAL_FIELD_LABELS.map(([key, label]) => `
              <label class="field">
                <span>${escapeHtml(label)}</span>
                <input type="number" name="${key}" min="0" step="0.1" value="${latestLab?.[key] !== undefined ? escapeHtml(latestLab[key]) : ''}">
              </label>
            `).join('')}
          </div>
          <div style="margin-top:12px;">
            <button type="submit" class="btn btn-secondary">Registrar Panel Clínico</button>
          </div>
        </form>
        <div id="clinical-evaluation-box" style="margin-top:12px;">
          ${renderLatestClinicalSummary(latestLab)}
        </div>
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <h3>Régimen Multi-empleo (${state.draftEmployments.length})</h3>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="add-employment-btn">+ Añadir Fuente</button>
          <button type="button" class="btn btn-primary btn-sm" id="save-employments-btn">Guardar Empleos</button>
        </div>
      </div>
      <div class="list-stack" id="employments-editor">
        ${renderEmploymentsEditor(state.draftEmployments)}
      </div>
    </article>

    <article class="card">
      <div class="card-head">
        <h3>Compromisos Recurrentes y Suscripciones</h3>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="add-commitment-btn">+ Añadir Compromiso</button>
          <button type="button" class="btn btn-primary btn-sm" id="save-commitments-btn">Guardar Compromisos</button>
        </div>
      </div>

      ${(snap.unpaidCommitments || []).length > 0 ? `
        <div class="list-stack" style="margin-bottom:12px;">
          ${snap.unpaidCommitments.map((u) => `
            <div class="alert-banner warn">
              <span><strong>Pago pendiente:</strong> ${escapeHtml(u.commitmentName)} ($${escapeHtml(u.expectedAmount)}) — periodo ${escapeHtml(u.periodKey)}</span>
              <button type="button" class="btn btn-primary btn-sm mark-paid-btn" data-name="${escapeHtml(u.commitmentName)}" data-amount="${escapeHtml(u.expectedAmount)}">Marcar Pagado</button>
            </div>
          `).join('')}
        </div>
      ` : '<div class="alert-banner ok" style="margin-bottom:12px;"><span>Sin pagos recurrentes vencidos pendientes para el periodo actual.</span></div>'}

      <div class="list-stack" id="commitments-editor">
        ${renderCommitmentsEditor(state.draftCommitments)}
      </div>
    </article>
  `;
}

function renderLatestClinicalSummary(panel) {
  if (!panel) return '<small>Registra un panel clínico para evaluar triglicéridos, glucosa y colesterol.</small>';
  const markers = [
    ['fastingGlucose', 'Glucosa', 70, 99],
    ['totalCholesterol', 'Colesterol', 0, 199],
    ['triglycerides', 'Triglicéridos', 0, 149],
    ['ldlCholesterol', 'LDL', 0, 99],
    ['hdlCholesterol', 'HDL', 40, 100],
    ['systolicPressure', 'Sistólica', 90, 120],
    ['diastolicPressure', 'Diastólica', 60, 80],
  ];
  const badges = [];
  for (const [k, label, min, max] of markers) {
    if (typeof panel[k] !== 'number') continue;
    const out = panel[k] < min || panel[k] > max;
    badges.push(`<span class="badge ${out ? 'badge-err' : 'badge-normal'}">${escapeHtml(label)}: ${panel[k]}</span>`);
  }
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;">${badges.join('')}</div>`;
}

function renderEmploymentsEditor(employments) {
  return employments.map((emp, idx) => {
    const winText = (emp.workingHoursWindows || []).map((w) => `${w.dayOfWeek}:${w.startHour}-${w.endHour}`).join(', ');
    const incomeAmount = emp.income?.amount ?? emp.fixedIncome?.amount ?? 0;
    const incomeFreq = emp.income?.frequency ?? emp.fixedIncome?.frequency ?? 'biweekly';
    const histAvg = (emp.historicalIncomes || []).map((h) => h.amount).join(', ');
    return `
      <div class="panel-elevated emp-row" data-emp-index="${idx}">
        <div class="field-row">
          <label class="field">
            <span>Título</span>
            <input type="text" class="emp-title" value="${escapeHtml(emp.title ?? '')}" placeholder="Ej. CAEV Oficial">
          </label>
          <label class="field">
            <span>Tipo</span>
            <select class="emp-type">
              <option value="fixed" ${emp.type === 'fixed' ? 'selected' : ''}>fixed</option>
              <option value="freelance" ${emp.type === 'freelance' ? 'selected' : ''}>freelance</option>
              <option value="contract" ${emp.type === 'contract' ? 'selected' : ''}>contract</option>
            </select>
          </label>
          ${emp.type === 'fixed' ? `
            <label class="field">
              <span>Ingreso ($)</span>
              <input type="number" class="emp-amount" min="0" value="${escapeHtml(incomeAmount)}">
            </label>
            <label class="field">
              <span>Frecuencia</span>
              <select class="emp-freq">
                <option value="weekly" ${incomeFreq === 'weekly' ? 'selected' : ''}>weekly</option>
                <option value="biweekly" ${incomeFreq === 'biweekly' ? 'selected' : ''}>biweekly</option>
                <option value="monthly" ${incomeFreq === 'monthly' ? 'selected' : ''}>monthly</option>
              </select>
            </label>
            <label class="field">
              <span>Ventanas (día:ini-fin)</span>
              <input type="text" class="emp-windows" value="${escapeHtml(winText)}" placeholder="1:8-15, 1:16-18">
            </label>
          ` : `
            <label class="field">
              <span>Meta horas/sem</span>
              <input type="number" class="emp-target-hours" min="0" max="168" value="${escapeHtml(emp.targetWeeklyHours ?? 0)}">
            </label>
            <label class="field">
              <span>Ingresos históricos ($)</span>
              <input type="text" class="emp-hist-incomes" value="${escapeHtml(histAvg)}" placeholder="2000, 3000">
            </label>
          `}
        </div>
        ${employments.length > 1 ? `<button type="button" class="btn btn-danger btn-sm remove-emp-btn" data-emp-index="${idx}" style="margin-top:8px;">Eliminar</button>` : ''}
      </div>
    `;
  }).join('');
}

function renderCommitmentsEditor(commitments) {
  return commitments.map((c, idx) => `
    <div class="panel-elevated comm-row" data-comm-index="${idx}">
      <div class="field-row">
        <label class="field"><span>Nombre</span><input type="text" class="comm-name" value="${escapeHtml(c.name ?? '')}" required></label>
        <label class="field"><span>Monto ($)</span><input type="number" class="comm-amount" min="1" step="0.01" value="${escapeHtml(c.amount ?? 100)}" required></label>
        <label class="field">
          <span>Frecuencia</span>
          <select class="comm-freq">
            <option value="weekly" ${c.frequency === 'weekly' ? 'selected' : ''}>weekly</option>
            <option value="biweekly" ${c.frequency === 'biweekly' ? 'selected' : ''}>biweekly</option>
            <option value="monthly" ${c.frequency === 'monthly' ? 'selected' : ''}>monthly</option>
            <option value="annual" ${c.frequency === 'annual' ? 'selected' : ''}>annual</option>
          </select>
        </label>
        <label class="field"><span>Día corte (1-31 opc.)</span><input type="number" class="comm-due-day" min="1" max="31" value="${c.dueDayOfMonth !== undefined && c.dueDayOfMonth !== null ? escapeHtml(c.dueDayOfMonth) : ''}"></label>
      </div>
      <button type="button" class="btn btn-danger btn-sm remove-comm-btn" data-comm-index="${idx}" style="margin-top:8px;">Eliminar</button>
    </div>
  `).join('') || '<small>Sin compromisos registrados. Usa "+ Añadir Compromiso".</small>';
}

async function renderCopilotView() {
  const modeLabel = state.copilotMode === 'ai_validated'
    ? '<span class="badge badge-accent">IA Validada</span>'
    : (state.copilotMode === 'deterministic_fallback'
      ? '<span class="badge badge-ok">Modo Determinista Local / Offline</span>'
      : '<span class="badge">Listo para analizar</span>');

  contentEl.innerHTML = `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>Captura Natural y Cola de Propuestas</h2>
          <small>Las propuestas nunca se auto-ejecutan: requieren tu confirmación humana explícita.</small>
        </div>
        ${modeLabel}
      </div>
      <form id="copilot-form">
        <label class="field">
          <span>Describe eventos, peso o pagos realizados</span>
          <textarea name="text" rows="3" required placeholder="Ej: Hoy peso 78.5 kg y pagué Netflix 220"></textarea>
        </label>
        <div style="margin-top:12px;">
          <button type="submit" class="btn btn-primary">Analizar y Generar Propuestas</button>
        </div>
      </form>
    </article>

    <article class="card">
      <div class="card-head">
        <h3>Propuestas Pendientes de Aprobación Humana (${state.copilotQueue.length})</h3>
      </div>
      ${state.copilotQueue.length > 0 ? `
        <div class="list-stack">
          ${state.copilotQueue.map((prop, idx) => `
            <div class="panel-elevated">
              <div class="card-head" style="margin-bottom:8px;">
                <span class="badge badge-accent">${escapeHtml(prop.type)}</span>
                <div style="display:flex;gap:8px;">
                  <button type="button" class="btn btn-primary btn-sm copilot-apply-btn" data-prop-index="${idx}">Confirmar y Aplicar</button>
                  <button type="button" class="btn btn-secondary btn-sm copilot-discard-btn" data-prop-index="${idx}">Descartar</button>
                </div>
              </div>
              <div class="mono" style="font-size:12px;">${escapeHtml(JSON.stringify(prop.payload))}</div>
              ${prop.rationale ? `<small style="color:var(--text-secondary);">${escapeHtml(prop.rationale)}</small>` : ''}
            </div>
          `).join('')}
        </div>
      ` : '<p style="color:var(--text-secondary);">Sin propuestas pendientes en cola.</p>'}
    </article>

    ${state.copilotRejected.length > 0 ? `
      <article class="card">
        <div class="card-head">
          <h3>Propuestas Bloqueadas por Políticas de Seguridad (${state.copilotRejected.length})</h3>
        </div>
        <div class="list-stack">
          ${state.copilotRejected.map((rej) => `
            <div class="alert-banner err">
              <span><strong>${escapeHtml(rej.raw?.type ?? 'desconocido')}:</strong> ${escapeHtml(rej.reason)}</span>
            </div>
          `).join('')}
        </div>
      </article>
    ` : ''}
  `;
}

async function renderSystemView() {
  const [storageHealth, modules, goals, tasks, habits, backups] = await Promise.all([
    apiFetch('/api/health/storage'),
    apiFetch('/api/modules'),
    apiFetch('/api/goals'),
    apiFetch('/api/tasks'),
    apiFetch('/api/habits'),
    apiFetch('/api/backups'),
  ]);
  state.storageHealth = storageHealth;
  state.modules = modules;
  state.goals = goals;
  state.tasks = tasks;
  state.habits = habits;
  state.backups = backups;

  contentEl.innerHTML = `
    <article class="card">
      <div class="card-head">
        <h2>Estado del Núcleo Local</h2>
        <span class="badge ${storageHealth.ok ? 'badge-ok' : 'badge-err'}">${storageHealth.ok ? 'Almacenamiento Íntegro' : 'Revisar Almacenamiento'}</span>
      </div>
      <div class="stats-grid">
        <div class="stat-box"><span>ESQUEMA SQLITE</span><strong>v${escapeHtml(storageHealth.schema_version)}</strong><small>Integridad: ${escapeHtml(storageHealth.integrity?.ok ? 'OK' : 'WARN')}</small></div>
        <div class="stat-box"><span>MÓDULOS ACTIVOS</span><strong>${modules.filter((m) => m.status === 'AVAILABLE').length}/${modules.length}</strong></div>
        <div class="stat-box"><span>METAS / TAREAS / HÁBITOS</span><strong>${goals.length} / ${tasks.length} / ${habits.length}</strong></div>
        <div class="stat-box"><span>RESPALDOS LOCALES</span><strong>${backups.length}</strong></div>
      </div>
    </article>

    <div class="grid-3">
      <article class="card">
        <div class="card-head"><h3>Metas (${goals.length})</h3></div>
        <form id="quick-goal-form" class="field-row" style="margin-bottom:10px;">
          <input type="text" name="name" required placeholder="Nueva meta...">
          <button type="submit" class="btn btn-primary btn-sm">Crear Meta</button>
        </form>
        <div class="list-stack">
          ${goals.slice(0, 6).map((g) => `<div class="list-row"><span>${escapeHtml(g.name)}</span><span class="badge">${escapeHtml(g.status)}</span></div>`).join('') || '<small>Sin metas.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Tareas (${tasks.length})</h3></div>
        <form id="quick-task-form" class="field-row" style="margin-bottom:10px;">
          <input type="text" name="title" required placeholder="Nueva tarea...">
          <button type="submit" class="btn btn-primary btn-sm">Crear Tarea</button>
        </form>
        <div class="list-stack">
          ${tasks.slice(0, 6).map((t) => `<div class="list-row"><span>${escapeHtml(t.title)}</span><span class="badge">${escapeHtml(t.status)}</span></div>`).join('') || '<small>Sin tareas.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Hábitos (${habits.length})</h3></div>
        <form id="quick-habit-form" class="field-row" style="margin-bottom:10px;">
          <input type="text" name="name" required placeholder="Nuevo hábito...">
          <button type="submit" class="btn btn-primary btn-sm">Crear Hábito</button>
        </form>
        <div class="list-stack">
          ${habits.slice(0, 6).map((h) => `<div class="list-row"><span>${escapeHtml(h.name)}</span><span class="badge">${escapeHtml(h.status)}</span></div>`).join('') || '<small>Sin hábitos.</small>'}
        </div>
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <h3>Respaldos Locales (${backups.length})</h3>
        <button type="button" class="btn btn-primary btn-sm" id="system-create-backup-btn">Crear Respaldo Local</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>Motivo</th><th>Esquema</th><th>Fecha</th></tr></thead>
          <tbody>
            ${backups.slice(0, 10).map((b) => `
              <tr>
                <td class="mono">${escapeHtml(b.id)}</td>
                <td>${escapeHtml(b.reason)}</td>
                <td>v${escapeHtml(b.schema_version)}</td>
                <td class="mono">${escapeHtml(b.created_at)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4">Sin respaldos registrados.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

async function renderCurrentView() {
  try {
    if (state.currentView === 'week') await renderWeekView();
    else if (state.currentView === 'saturday') await renderSaturdayView();
    else if (state.currentView === 'spaces') await renderSpacesView();
    else if (state.currentView === 'copilot') await renderCopilotView();
    else if (state.currentView === 'system') await renderSystemView();
  } catch (err) {
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
}

function parseWindowsText(text) {
  return String(text || '')
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = /^([0-6]):(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(chunk);
      if (!m) throw new Error(`Ventana horaria inválida: "${chunk}". Usa formato día:ini-fin (ej. 1:8-15).`);
      return { dayOfWeek: Number(m[1]), startHour: Number(m[2]), endHour: Number(m[3]) };
    });
}

function collectEmploymentsFromDom() {
  const rows = [...document.querySelectorAll('#employments-editor .emp-row')];
  return rows.map((row) => {
    const title = row.querySelector('.emp-title')?.value?.trim() || undefined;
    const type = row.querySelector('.emp-type')?.value || 'fixed';
    if (type === 'fixed') {
      const amount = Number(row.querySelector('.emp-amount')?.value ?? 0);
      const frequency = row.querySelector('.emp-freq')?.value || 'biweekly';
      const workingHoursWindows = parseWindowsText(row.querySelector('.emp-windows')?.value || '');
      return { type: 'fixed', title, workingHoursWindows, income: { amount, frequency } };
    }
    const targetWeeklyHours = Number(row.querySelector('.emp-target-hours')?.value ?? 0);
    const rawHist = row.querySelector('.emp-hist-incomes')?.value || '';
    const historicalIncomes = rawHist
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => ({ amount: Number(s) }));
    return { type, title, targetWeeklyHours, historicalIncomes };
  });
}

function collectCommitmentsFromDom() {
  const rows = [...document.querySelectorAll('#commitments-editor .comm-row')];
  return rows.map((row) => {
    const name = row.querySelector('.comm-name')?.value?.trim() || '';
    const amount = Number(row.querySelector('.comm-amount')?.value ?? 0);
    const frequency = row.querySelector('.comm-freq')?.value || 'monthly';
    const rawDue = row.querySelector('.comm-due-day')?.value;
    const comm = { name, amount, frequency };
    if (rawDue !== undefined && rawDue !== '') {
      comm.dueDayOfMonth = Number(rawDue);
    }
    return comm;
  });
}

// Delegación de eventos en contentEl (cumple CSP: cero onclick/onsubmit inline)
contentEl.addEventListener('click', async (e) => {
  const jumpBtn = e.target.closest('[data-jump-view]');
  if (jumpBtn) {
    switchView(jumpBtn.dataset.jumpView);
    return;
  }

  const execSaveBtn = e.target.closest('.exec-save-btn');
  if (execSaveBtn) {
    const blockId = execSaveBtn.dataset.blockId;
    const blockCard = execSaveBtn.closest('.block-item');
    const status = blockCard.querySelector('.exec-status-select')?.value;
    const reason = blockCard.querySelector('.exec-reason-input')?.value?.trim() || null;
    try {
      await apiFetch(`/api/planning/baselines/${encodeURIComponent(state.selectedBaselineId)}/executions`, {
        method: 'POST',
        body: JSON.stringify({ blockId, status, reason }),
      });
      showToast(`Ejecución registrada (${status}).`, { type: 'ok' });
      await renderCurrentView();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
    return;
  }

  if (e.target.id === 'approve-seal-btn') {
    const review = state.saturdayReview;
    if (!review?.nextWeekDraft) return;
    try {
      const sealed = await apiFetch('/api/planning/saturday/approve', {
        method: 'POST',
        body: JSON.stringify({ draft: review.nextWeekDraft, approvedBy: 'user' }),
      });
      state.selectedBaselineId = sealed.baselineId;
      state.saturdayReview = null;
      showToast(`Baseline ${sealed.baselineId} sellada como inmutable.`, { type: 'ok' });
      switchView('week');
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
    return;
  }

  if (e.target.id === 'add-employment-btn') {
    state.draftEmployments.push({ type: 'freelance', title: 'Nueva fuente', targetWeeklyHours: 5, historicalIncomes: [] });
    document.getElementById('employments-editor').innerHTML = renderEmploymentsEditor(state.draftEmployments);
    return;
  }

  const removeEmpBtn = e.target.closest('.remove-emp-btn');
  if (removeEmpBtn) {
    const idx = Number(removeEmpBtn.dataset.empIndex);
    state.draftEmployments.splice(idx, 1);
    document.getElementById('employments-editor').innerHTML = renderEmploymentsEditor(state.draftEmployments);
    return;
  }

  if (e.target.id === 'save-employments-btn') {
    try {
      const employments = collectEmploymentsFromDom();
      await apiFetch('/api/spaces/employments', {
        method: 'PUT',
        body: JSON.stringify({ employments }),
      });
      showToast('Empleos guardados correctamente.', { type: 'ok' });
      await renderCurrentView();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
    return;
  }

  if (e.target.id === 'add-commitment-btn') {
    state.draftCommitments.push({ name: 'Nuevo servicio', amount: 200, frequency: 'monthly' });
    document.getElementById('commitments-editor').innerHTML = renderCommitmentsEditor(state.draftCommitments);
    return;
  }

  const removeCommBtn = e.target.closest('.remove-comm-btn');
  if (removeCommBtn) {
    const idx = Number(removeCommBtn.dataset.commIndex);
    state.draftCommitments.splice(idx, 1);
    document.getElementById('commitments-editor').innerHTML = renderCommitmentsEditor(state.draftCommitments);
    return;
  }

  if (e.target.id === 'save-commitments-btn') {
    try {
      const recurringCommitments = collectCommitmentsFromDom();
      await apiFetch('/api/spaces/commitments', {
        method: 'PUT',
        body: JSON.stringify({ recurringCommitments }),
      });
      showToast('Compromisos recurrentes guardados.', { type: 'ok' });
      await renderCurrentView();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
    return;
  }

  const markPaidBtn = e.target.closest('.mark-paid-btn');
  if (markPaidBtn) {
    try {
      await apiFetch('/api/spaces/commitments/payments', {
        method: 'POST',
        body: JSON.stringify({
          commitmentName: markPaidBtn.dataset.name,
          amount: Number(markPaidBtn.dataset.amount),
        }),
      });
      showToast(`Pago registrado para ${markPaidBtn.dataset.name}.`, { type: 'ok' });
      await renderCurrentView();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
    return;
  }

  const applyPropBtn = e.target.closest('.copilot-apply-btn');
  if (applyPropBtn) {
    const idx = Number(applyPropBtn.dataset.propIndex);
    const prop = state.copilotQueue[idx];
    if (!prop) return;
    try {
      if (prop.type === 'update_weight') {
        await apiFetch('/api/spaces/biometrics', {
          method: 'PATCH',
          body: JSON.stringify({ currentWeightKg: prop.payload.currentWeightKg }),
        });
      } else if (prop.type === 'record_payment') {
        await apiFetch('/api/spaces/commitments/payments', {
          method: 'POST',
          body: JSON.stringify(prop.payload),
        });
      } else if (prop.type === 'log_execution') {
        const targetBaselineId = prop.payload.baselineId || state.selectedBaselineId;
        if (!targetBaselineId) throw new Error('Selecciona una baseline activa en Semana Activa para registrar la ejecución.');
        await apiFetch(`/api/planning/baselines/${encodeURIComponent(targetBaselineId)}/executions`, {
          method: 'POST',
          body: JSON.stringify(prop.payload),
        });
      } else {
        showToast(`Edita "${prop.type}" directamente en Espacios Especializados para confirmarlo.`, { type: 'info' });
        switchView('spaces');
        return;
      }
      state.copilotQueue.splice(idx, 1);
      showToast(`Propuesta "${prop.type}" confirmada y aplicada.`, { type: 'ok' });
      await renderCurrentView();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
    return;
  }

  const discardPropBtn = e.target.closest('.copilot-discard-btn');
  if (discardPropBtn) {
    const idx = Number(discardPropBtn.dataset.propIndex);
    state.copilotQueue.splice(idx, 1);
    await renderCurrentView();
    return;
  }

  if (e.target.id === 'system-create-backup-btn') {
    try {
      const bkp = await apiFetch('/api/backups', { method: 'POST', body: JSON.stringify({ reason: 'web-system' }) });
      showToast(`Respaldo ${bkp.id} creado.`, { type: 'ok' });
      await renderCurrentView();
    } catch (err) {
      showToast(err.message, { type: 'err', remediation: err.remediation });
    }
  }
});

contentEl.addEventListener('change', async (e) => {
  if (e.target.id === 'baseline-selector') {
    state.selectedBaselineId = e.target.value;
    await renderCurrentView();
    return;
  }

  if (e.target.id === 'approve-confirm-checkbox') {
    const btn = document.getElementById('approve-seal-btn');
    if (btn) btn.disabled = !e.target.checked;
    return;
  }

  if (e.target.classList.contains('exec-status-select')) {
    const card = e.target.closest('.block-item');
    const reasonInput = card?.querySelector('.exec-reason-input');
    if (reasonInput) {
      const isMissed = e.target.value === 'missed_with_reason';
      reasonInput.classList.toggle('reason-required', isMissed);
      reasonInput.placeholder = isMissed ? 'Motivo obligatorio...' : 'Motivo opcional...';
    }
    return;
  }

  if (e.target.classList.contains('emp-type')) {
    const row = e.target.closest('.emp-row');
    const idx = Number(row.dataset.empIndex);
    state.draftEmployments[idx] = {
      type: e.target.value,
      title: row.querySelector('.emp-title')?.value?.trim() || '',
      workingHoursWindows: [],
      income: { amount: 0, frequency: 'biweekly' },
      targetWeeklyHours: 0,
      historicalIncomes: [],
    };
    document.getElementById('employments-editor').innerHTML = renderEmploymentsEditor(state.draftEmployments);
  }
});

contentEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;

  try {
    if (form.id === 'revision-form') {
      const fd = new FormData(form);
      await apiFetch(`/api/planning/baselines/${encodeURIComponent(state.selectedBaselineId)}/revisions`, {
        method: 'POST',
        body: JSON.stringify({
          originalBlockId: fd.get('originalBlockId'),
          changeType: 'reschedule',
          newWindow: {
            dayOfWeek: Number(fd.get('newDayOfWeek')),
            startHour: Number(fd.get('newStartHour')),
            endHour: Number(fd.get('newEndHour')),
          },
          reason: fd.get('reason'),
          authorizedBy: 'user',
        }),
      });
      showToast('Reprogramación registrada sin alterar la baseline original.', { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'saturday-prepare-form') {
      const fd = new FormData(form);
      const exerciseScheduleRequests = [];
      document.querySelectorAll('.sat-ex-check:checked').forEach((chk) => {
        const exId = chk.dataset.exId;
        const daysStr = document.querySelector(`.sat-ex-days[data-ex-id="${exId}"]`)?.value || '';
        const daysOfWeek = daysStr
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number)
          .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
        const preferredStartHour = Number(document.querySelector(`.sat-ex-hour[data-ex-id="${exId}"]`)?.value ?? 7);
        const durationMinutes = Number(document.querySelector(`.sat-ex-dur[data-ex-id="${exId}"]`)?.value ?? 30);
        exerciseScheduleRequests.push({ exerciseId: exId, daysOfWeek, preferredStartHour, durationMinutes });
      });

      const review = await apiFetch('/api/planning/saturday/prepare', {
        method: 'POST',
        body: JSON.stringify({
          nextWeekStartDate: fd.get('nextWeekStartDate'),
          weeklyGroceryBudget: Number(fd.get('weeklyGroceryBudget') || 0),
          previousBaselineId: fd.get('previousBaselineId') || null,
          exerciseScheduleRequests,
        }),
      });
      state.saturdayReview = review;
      showToast('Borrador semanal del sábado generado.', { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'init-profile-form') {
      const fd = new FormData(form);
      await apiFetch('/api/spaces/profile', {
        method: 'POST',
        body: JSON.stringify({
          profile: {
            biometrics: {
              birthDate: fd.get('birthDate'),
              heightCm: Number(fd.get('heightCm')),
              currentWeightKg: Number(fd.get('currentWeightKg')),
              sex: fd.get('sex'),
            },
            employments: [
              {
                type: 'fixed',
                title: fd.get('empTitle'),
                workingHoursWindows: [{ dayOfWeek: 1, startHour: 9, endHour: 17 }],
                income: { amount: Number(fd.get('empAmount')), frequency: 'biweekly' },
              },
            ],
            recurringCommitments: [
              { name: fd.get('commName'), amount: Number(fd.get('commAmount')), frequency: 'monthly' },
            ],
            preferences: { dislikedIngredients: [] },
          },
        }),
      });
      showToast('Perfil personal inicializado.', { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'quick-weight-form') {
      const fd = new FormData(form);
      await apiFetch('/api/spaces/biometrics', {
        method: 'PATCH',
        body: JSON.stringify({ currentWeightKg: Number(fd.get('currentWeightKg')) }),
      });
      showToast('Peso biométrico actualizado.', { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'clinical-panel-form') {
      const fd = new FormData(form);
      const panel = {};
      for (const [key] of CLINICAL_FIELD_LABELS) {
        const raw = fd.get(key);
        if (raw !== null && String(raw).trim() !== '') {
          panel[key] = Number(raw);
        }
      }
      const res = await apiFetch('/api/spaces/clinical', {
        method: 'POST',
        body: JSON.stringify(panel),
      });
      showToast(
        res.evaluation?.hasAlerts
          ? 'Panel registrado con biomarcadores fuera de rango.'
          : 'Panel clínico registrado dentro de rangos normales.',
        { type: res.evaluation?.hasAlerts ? 'info' : 'ok' }
      );
      await renderCurrentView();
      return;
    }

    if (form.id === 'copilot-form') {
      const fd = new FormData(form);
      const res = await apiFetch('/api/copilot/proposals', {
        method: 'POST',
        body: JSON.stringify({ text: fd.get('text') }),
      });
      state.copilotMode = res.mode;
      state.copilotQueue = [...state.copilotQueue, ...(res.acceptedProposals || [])];
      state.copilotRejected = res.rejectedProposals || [];
      showToast(`Propuestas generadas (${res.acceptedProposals?.length ?? 0}).`, { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'quick-goal-form') {
      const fd = new FormData(form);
      await apiFetch('/api/goals', { method: 'POST', body: JSON.stringify({ name: fd.get('name') }) });
      showToast('Meta creada.', { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'quick-task-form') {
      const fd = new FormData(form);
      await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify({ title: fd.get('title') }) });
      showToast('Tarea creada.', { type: 'ok' });
      await renderCurrentView();
      return;
    }

    if (form.id === 'quick-habit-form') {
      const fd = new FormData(form);
      await apiFetch('/api/habits', {
        method: 'POST',
        body: JSON.stringify({ name: fd.get('name'), frequency: { type: 'DAILY' } }),
      });
      showToast('Hábito creado.', { type: 'ok' });
      await renderCurrentView();
    }
  } catch (err) {
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
});

// Navegación por pestañas y accesibilidad por teclado (Alt+1..5 y flechas en tablist)
const mainNavEl = document.getElementById('main-nav');
const viewOrder = ['week', 'saturday', 'spaces', 'copilot', 'system'];

mainNavEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-tab');
  if (btn?.dataset.view) switchView(btn.dataset.view);
});

mainNavEl.addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  e.preventDefault();
  const idx = viewOrder.indexOf(state.currentView);
  const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
  const nextView = viewOrder[(idx + delta + viewOrder.length) % viewOrder.length];
  switchView(nextView);
  document.getElementById(`tab-${nextView}`)?.focus();
});

document.addEventListener('keydown', (e) => {
  if (!e.altKey) return;
  const index = Number(e.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < viewOrder.length) {
    e.preventDefault();
    switchView(viewOrder[index]);
  }
});

document.getElementById('sidebar-toggle').addEventListener('click', (e) => {
  const shell = document.getElementById('app-shell');
  const collapsed = shell.classList.toggle('sidebar-collapsed');
  e.currentTarget.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

document.getElementById('refresh-btn').addEventListener('click', async () => {
  await refreshGlobalStatus();
  await renderCurrentView();
});

document.getElementById('quick-backup-btn').addEventListener('click', async () => {
  try {
    const bkp = await apiFetch('/api/backups', {
      method: 'POST',
      body: JSON.stringify({ reason: 'web-topbar' }),
    });
    showToast(`Respaldo ${bkp.id} creado.`, { type: 'ok' });
    if (state.currentView === 'system') await renderCurrentView();
  } catch (err) {
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
});

await refreshGlobalStatus();
await renderCurrentView();
