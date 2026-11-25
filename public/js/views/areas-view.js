import { apiFetch, DAY_NAMES, escapeHtml, showToast, todayLocalIso } from '../api.js';
import { state } from '../state.js';

const SUBTABS = [
  ['finance', 'Finanzas'],
  ['projects', 'Proyectos, Metas y Tareas'],
  ['habits', 'Hábitos y Rutinas'],
  ['inventory', 'Inventario y Despensa'],
];

const PROJECT_STATUSES = ['PLANNING', 'ACTIVE', 'PAUSED', 'BLOCKED', 'COMPLETED', 'CANCELLED'];
const TASK_STATUSES = ['PENDING', 'PREPARATION', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'COMPLETED', 'CANCELLED'];
const GOAL_HORIZONS = ['SHORT', 'MEDIUM', 'LONG'];

async function loadAreasData() {
  const txFilter = state.financeTypeFilter ? `?type=${encodeURIComponent(state.financeTypeFilter)}` : '';
  const [summary, accounts, transactions, goals, projects, tasks, habits, routines, products, stock] = await Promise.all([
    apiFetch('/api/finance/summary'),
    apiFetch('/api/finance/accounts'),
    apiFetch(`/api/finance/transactions${txFilter}`),
    apiFetch('/api/goals'),
    apiFetch('/api/projects'),
    apiFetch('/api/tasks'),
    apiFetch('/api/habits'),
    apiFetch('/api/routines'),
    apiFetch('/api/inventory/products'),
    apiFetch('/api/inventory/stock'),
  ]);
  state.financeSummary = summary;
  state.financeAccounts = accounts || [];
  state.financeTransactions = transactions || [];
  state.goals = goals || [];
  state.projects = projects || [];
  state.tasks = tasks || [];
  state.habits = habits || [];
  state.routines = routines || [];
  state.inventoryProducts = products || [];
  state.inventoryStock = stock || [];
}

function buildResourceImpactFromForm(fd) {
  const finTarget = fd.get('fin_targetAmount');
  const finPeriodic = fd.get('fin_periodicContribution');
  const finFreq = fd.get('fin_frequency') || 'biweekly';
  const finDate = fd.get('fin_targetDate');
  const timeHours = fd.get('time_weeklyHoursRequired');
  const healthTarget = fd.get('health_targetMetric');
  const healthDelta = fd.get('health_weeklyTargetDelta');
  const healthCurrent = fd.get('health_currentMetric');

  const impact = {};
  if ((finTarget && Number(finTarget) > 0) || (finPeriodic && Number(finPeriodic) > 0)) {
    impact.financial = {
      periodicContribution: Number(finPeriodic || 0),
      frequency: finFreq,
      currency: 'MXN',
      ...(finTarget ? { targetAmount: Number(finTarget) } : {}),
      ...(finDate ? { targetDate: finDate } : {}),
    };
  }
  if (timeHours && Number(timeHours) > 0) {
    impact.time = { weeklyHoursRequired: Number(timeHours) };
  }
  if (healthTarget && Number(healthTarget) > 0) {
    impact.health = {
      metricType: 'weight_kg',
      targetMetric: Number(healthTarget),
      weeklyTargetDelta: Number(healthDelta || 0),
      ...(healthCurrent ? { currentMetric: Number(healthCurrent) } : {}),
    };
  }
  return Object.keys(impact).length > 0 ? impact : null;
}

function renderGoalResourceFields(ri = null) {
  const fin = ri?.financial || {};
  const time = ri?.time || {};
  const health = ri?.health || {};
  return `
    <details class="collapsible" ${ri ? 'open' : ''}>
      <summary>Configurar impacto en recursos (Financiero / Tiempo / Salud)</summary>
      <div class="field-row" style="margin-top:8px;">
        <label class="field"><span>Meta financiera ($)</span><input type="number" name="fin_targetAmount" min="0" step="10" value="${escapeHtml(fin.targetAmount ?? '')}"></label>
        <label class="field"><span>Aporte periódico ($)</span><input type="number" name="fin_periodicContribution" min="0" step="10" value="${escapeHtml(fin.periodicContribution ?? '')}"></label>
        <label class="field"><span>Frecuencia</span>
          <select name="fin_frequency">
            <option value="weekly" ${fin.frequency === 'weekly' ? 'selected' : ''}>weekly</option>
            <option value="biweekly" ${!fin.frequency || fin.frequency === 'biweekly' ? 'selected' : ''}>biweekly</option>
            <option value="monthly" ${fin.frequency === 'monthly' ? 'selected' : ''}>monthly</option>
          </select>
        </label>
        <label class="field"><span>Fecha objetivo fin.</span><input type="date" name="fin_targetDate" value="${escapeHtml(fin.targetDate ?? '')}"></label>
      </div>
      <div class="field-row" style="margin-top:8px;">
        <label class="field"><span>Horas semanales req.</span><input type="number" name="time_weeklyHoursRequired" min="0" max="168" step="0.5" value="${escapeHtml(time.weeklyHoursRequired ?? '')}"></label>
        <label class="field"><span>Peso actual (kg opc.)</span><input type="number" name="health_currentMetric" min="0" step="0.1" value="${escapeHtml(health.currentMetric ?? '')}"></label>
        <label class="field"><span>Peso objetivo (kg)</span><input type="number" name="health_targetMetric" min="0" step="0.1" value="${escapeHtml(health.targetMetric ?? '')}"></label>
        <label class="field"><span>Delta semanal (kg)</span><input type="number" name="health_weeklyTargetDelta" step="0.1" value="${escapeHtml(health.weeklyTargetDelta ?? '')}" placeholder="-0.5"></label>
      </div>
    </details>
  `;
}

function renderFinanceTab() {
  const currencies = Object.values(state.financeSummary?.currencies || {});
  const accountOpts = state.financeAccounts
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`)
    .join('');

  return `
    <div class="stats-grid">
      ${
        currencies
          .map(
            (c) => `
        <div class="stat-box">
          <span>BALANCE ${escapeHtml(c.currency)}</span>
          <strong>$${escapeHtml(c.calculated_balance)}</strong>
          <small>Disponible: $${escapeHtml(c.available_money)} · Ing: $${escapeHtml(c.total_income)} / Gas: $${escapeHtml(c.total_expense)}</small>
        </div>
      `
          )
          .join('') || '<div class="stat-box"><span>FINANZAS</span><strong>Sin cuentas</strong><small>Crea una cuenta para empezar</small></div>'
      }
    </div>

    <div class="grid-3">
      <article class="card">
        <div class="card-head"><h3>Nueva Cuenta</h3></div>
        <form id="area-account-form" class="list-stack">
          <label class="field"><span>Nombre</span><input type="text" name="name" required placeholder="Ej. Débito BBVA"></label>
          <label class="field"><span>Tipo</span>
            <select name="account_type">
              <option value="BANK">BANK</option>
              <option value="CASH">CASH</option>
              <option value="WALLET">WALLET</option>
            </select>
          </label>
          <label class="field"><span>Moneda</span><input type="text" name="currency" value="MXN" required></label>
          <button type="submit" class="btn btn-primary btn-sm">Crear Cuenta</button>
        </form>
      </article>

      <article class="card">
        <div class="card-head"><h3>Registrar Ingreso</h3></div>
        <form id="area-income-form" class="list-stack">
          <label class="field"><span>Cuenta</span><select name="account_id" required>${accountOpts || '<option value="">Crea una cuenta primero</option>'}</select></label>
          <label class="field"><span>Monto</span><input type="number" name="amount" min="0.01" step="0.01" required></label>
          <label class="field"><span>Categoría</span><input type="text" name="category" value="salary" required></label>
          <label class="field"><span>Descripción</span><input type="text" name="description" required placeholder="Nómina / Cobro"></label>
          <button type="submit" class="btn btn-primary btn-sm" ${!accountOpts ? 'disabled' : ''}>Registrar Ingreso</button>
        </form>
      </article>

      <article class="card">
        <div class="card-head"><h3>Registrar Gasto</h3></div>
        <form id="area-expense-form" class="list-stack">
          <label class="field"><span>Cuenta</span><select name="account_id" required>${accountOpts || '<option value="">Crea una cuenta primero</option>'}</select></label>
          <label class="field"><span>Monto</span><input type="number" name="amount" min="0.01" step="0.01" required></label>
          <label class="field"><span>Categoría</span><input type="text" name="category" value="general" required></label>
          <label class="field"><span>Descripción</span><input type="text" name="description" required placeholder="Compra / Servicio"></label>
          <button type="submit" class="btn btn-secondary btn-sm" ${!accountOpts ? 'disabled' : ''}>Registrar Gasto</button>
        </form>
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <h3>Transacciones Recientes (${state.financeTransactions.length})</h3>
        <select id="area-tx-filter" style="width:auto;min-width:170px;" aria-label="Filtrar tipo de transacción">
          <option value="" ${state.financeTypeFilter === '' ? 'selected' : ''}>Todos los tipos</option>
          <option value="INCOME" ${state.financeTypeFilter === 'INCOME' ? 'selected' : ''}>Solo Ingresos</option>
          <option value="EXPENSE" ${state.financeTypeFilter === 'EXPENSE' ? 'selected' : ''}>Solo Gastos</option>
        </select>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Monto</th></tr></thead>
          <tbody>
            ${state.financeTransactions
              .slice(0, 20)
              .map(
                (tx) => `
              <tr>
                <td class="mono">${escapeHtml(String(tx.occurred_at || '').slice(0, 10))}</td>
                <td><span class="badge ${tx.transaction_type === 'INCOME' ? 'badge-ok' : 'badge-warn'}">${escapeHtml(tx.transaction_type)}</span></td>
                <td>${escapeHtml(tx.category)}</td>
                <td>${escapeHtml(tx.description)}</td>
                <td class="mono">$${escapeHtml(tx.amount)} ${escapeHtml(tx.currency)}</td>
              </tr>
            `
              )
              .join('') || '<tr><td colspan="5">Sin transacciones registradas.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderProjectsTab() {
  const activeProjects = state.projects.filter((p) => p.status !== 'ARCHIVED');

  return `
    <div class="grid-3">
      <article class="card">
        <div class="card-head"><h3>Metas (${state.goals.length})</h3></div>
        <form id="area-goal-form" class="list-stack" style="margin-bottom:12px;">
          <div style="display:flex;gap:8px;">
            <input type="text" name="name" required placeholder="Nueva meta...">
            <select name="horizon" style="max-width:110px;">
              ${GOAL_HORIZONS.map((h) => `<option value="${h}">${h}</option>`).join('')}
            </select>
          </div>
          ${renderGoalResourceFields(null)}
          <button type="submit" class="btn btn-primary btn-sm">Crear Meta</button>
        </form>
        <div class="list-stack">
          ${state.goals
            .map(
              (g) => `
            <div class="panel-elevated">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <span><strong>${escapeHtml(g.name)}</strong> <span class="badge">${escapeHtml(g.status)}</span></span>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn btn-secondary btn-sm area-goal-edit-toggle" data-id="${escapeHtml(g.id)}">Editar</button>
                  ${g.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-danger btn-sm area-goal-del-btn" data-id="${escapeHtml(g.id)}">Archivar</button>` : ''}
                </div>
              </div>
              ${
                state.editingGoalId === g.id
                  ? `
                <form class="areas-edit-panel area-goal-edit-form" data-id="${escapeHtml(g.id)}">
                  <div class="field-row">
                    <label class="field"><span>Nombre</span><input type="text" name="name" required value="${escapeHtml(g.name)}"></label>
                    <label class="field"><span>Horizonte</span>
                      <select name="horizon">${GOAL_HORIZONS.map((h) => `<option value="${h}" ${g.horizon === h ? 'selected' : ''}>${h}</option>`).join('')}</select>
                    </label>
                    <label class="field"><span>Fecha objetivo</span><input type="date" name="target_date" value="${escapeHtml(g.target_date || '')}"></label>
                  </div>
                  ${renderGoalResourceFields(g.resourceImpact)}
                  <div style="display:flex;gap:6px;">
                    <button type="submit" class="btn btn-primary btn-sm">Guardar Cambios</button>
                    <button type="button" class="btn btn-secondary btn-sm area-edit-cancel-btn">Cancelar</button>
                  </div>
                </form>
              `
                  : ''
              }
            </div>
          `
            )
            .join('') || '<small>Sin metas.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Proyectos (${state.projects.length})</h3></div>
        <form id="area-project-form" class="list-stack" style="margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nuevo proyecto...">
          <div class="field-row">
            <label class="field"><span>Inicio</span><input type="date" name="start_date"></label>
            <label class="field"><span>Objetivo</span><input type="date" name="target_date"></label>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Crear Proyecto</button>
        </form>
        <div class="list-stack">
          ${state.projects
            .map(
              (p) => `
            <div class="panel-elevated">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <span><strong>${escapeHtml(p.name)}</strong> <span class="badge">${escapeHtml(p.status)}</span></span>
                <div style="display:flex;gap:6px;">
                  <button type="button" class="btn btn-secondary btn-sm area-proj-edit-toggle" data-id="${escapeHtml(p.id)}">Editar</button>
                  ${p.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-danger btn-sm area-proj-del-btn" data-id="${escapeHtml(p.id)}">Archivar</button>` : ''}
                </div>
              </div>
              ${
                state.editingProjectId === p.id
                  ? `
                <form class="areas-edit-panel area-proj-edit-form" data-id="${escapeHtml(p.id)}">
                  <label class="field"><span>Nombre</span><input type="text" name="name" required value="${escapeHtml(p.name)}"></label>
                  <div class="field-row">
                    <label class="field"><span>Estado</span>
                      <select name="status">${PROJECT_STATUSES.map((s) => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
                    </label>
                    <label class="field"><span>Inicio</span><input type="date" name="start_date" value="${escapeHtml(p.start_date || '')}"></label>
                    <label class="field"><span>Objetivo</span><input type="date" name="target_date" value="${escapeHtml(p.target_date || '')}"></label>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button type="submit" class="btn btn-primary btn-sm">Guardar Cambios</button>
                    <button type="button" class="btn btn-secondary btn-sm area-edit-cancel-btn">Cancelar</button>
                  </div>
                </form>
              `
                  : ''
              }
            </div>
          `
            )
            .join('') || '<small>Sin proyectos.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Tareas (${state.tasks.length})</h3></div>
        <form id="area-task-form" class="list-stack" style="margin-bottom:12px;">
          <input type="text" name="title" required placeholder="Nueva tarea...">
          <div class="field-row">
            <select name="project_id">
              <option value="">Sin proyecto</option>
              ${activeProjects.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
            </select>
            <input type="date" name="due_date" aria-label="Fecha límite">
            <input type="number" name="urgency" min="1" max="4" value="3" title="Prioridad / Urgencia (1-4)">
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Crear Tarea</button>
        </form>
        <div class="list-stack">
          ${state.tasks
            .map(
              (t) => `
            <div class="panel-elevated">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
                <span><strong>${escapeHtml(t.title)}</strong> <span class="badge ${t.status === 'COMPLETED' ? 'badge-ok' : ''}">${escapeHtml(t.status)}</span></span>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  ${t.status !== 'COMPLETED' && t.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-primary btn-sm area-task-done-btn" data-id="${escapeHtml(t.id)}">✓</button>` : ''}
                  <button type="button" class="btn btn-secondary btn-sm area-task-edit-toggle" data-id="${escapeHtml(t.id)}">Editar</button>
                  ${t.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-danger btn-sm area-task-del-btn" data-id="${escapeHtml(t.id)}">Archivar</button>` : ''}
                </div>
              </div>
              ${
                state.editingTaskId === t.id
                  ? `
                <form class="areas-edit-panel area-task-edit-form" data-id="${escapeHtml(t.id)}">
                  <label class="field"><span>Título</span><input type="text" name="title" required value="${escapeHtml(t.title)}"></label>
                  <div class="field-row">
                    <label class="field"><span>Estado</span>
                      <select name="status">${TASK_STATUSES.map((s) => `<option value="${s}" ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
                    </label>
                    <label class="field"><span>Fecha límite</span><input type="date" name="due_date" value="${escapeHtml(t.due_date || '')}"></label>
                    <label class="field"><span>Urgencia (1-4)</span><input type="number" name="urgency" min="1" max="4" value="${escapeHtml(t.urgency ?? 3)}"></label>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button type="submit" class="btn btn-primary btn-sm">Guardar Cambios</button>
                    <button type="button" class="btn btn-secondary btn-sm area-edit-cancel-btn">Cancelar</button>
                  </div>
                </form>
              `
                  : ''
              }
            </div>
          `
            )
            .join('') || '<small>Sin tareas.</small>'}
        </div>
      </article>
    </div>
  `;
}

function renderHabitsTab() {
  return `
    <div class="grid-2">
      <article class="card">
        <div class="card-head"><h3>Hábitos (${state.habits.length})</h3></div>
        <form id="area-habit-form" class="list-stack" style="margin-bottom:14px;">
          <div class="field-row">
            <label class="field"><span>Nombre</span><input type="text" name="name" required placeholder="Ej. Meditar 10m"></label>
            <label class="field"><span>Categoría</span><input type="text" name="category" value="health" placeholder="health / learning"></label>
            <label class="field"><span>Frecuencia</span>
              <select name="freq_type" id="area-habit-freq-type">
                <option value="DAILY">DAILY (Todos los días)</option>
                <option value="SPECIFIC_DAYS">SPECIFIC_DAYS (Días elegidos)</option>
              </select>
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <span style="font-size:12px;color:var(--text-secondary);">Días (si aplica):</span>
            ${DAY_NAMES.map((name, idx) => `
              <label class="checkbox-inline" style="font-size:12px;">
                <input type="checkbox" name="weekdays" value="${idx}" ${idx >= 1 && idx <= 5 ? 'checked' : ''}>
                <span>${escapeHtml(name.slice(0, 3))}</span>
              </label>
            `).join('')}
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Crear Hábito</button>
        </form>
        <div class="list-stack">
          ${state.habits
            .map(
              (h) => `
            <div class="panel-elevated habit-occ-card" data-habit-id="${escapeHtml(h.id)}">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                <div>
                  <strong>${escapeHtml(h.name)}</strong>
                  <small style="color:var(--text-secondary);"> · ${escapeHtml(h.category || 'general')} · ${escapeHtml(h.frequency?.type || 'DAILY')}</small>
                </div>
                <span class="badge">${escapeHtml(h.status)}</span>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <input type="text" class="habit-occ-note" placeholder="Nota opcional del día..." style="flex:1;min-width:140px;">
                <button type="button" class="btn btn-primary btn-sm area-habit-occ-btn" data-id="${escapeHtml(h.id)}" data-status="COMPLETED">COMPLETED</button>
                <button type="button" class="btn btn-secondary btn-sm area-habit-occ-btn" data-id="${escapeHtml(h.id)}" data-status="PARTIAL">PARTIAL</button>
                <button type="button" class="btn btn-danger btn-sm area-habit-occ-btn" data-id="${escapeHtml(h.id)}" data-status="MISSED">MISSED</button>
                <button type="button" class="btn btn-secondary btn-sm area-habit-occ-btn" data-id="${escapeHtml(h.id)}" data-status="SKIPPED">SKIPPED</button>
              </div>
            </div>
          `
            )
            .join('') || '<small>Sin hábitos registrados.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Rutinas (${state.routines.length})</h3></div>
        <form id="area-routine-form" style="display:flex;gap:8px;margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nueva rutina...">
          <button type="submit" class="btn btn-primary btn-sm">Crear Rutina</button>
        </form>
        <div class="list-stack">
          ${state.routines
            .map(
              (r) => `
            <div class="list-row">
              <span>${escapeHtml(r.name)}</span>
              <span class="badge">${escapeHtml(r.status)}</span>
            </div>
          `
            )
            .join('') || '<small>Sin rutinas registradas.</small>'}
        </div>
      </article>
    </div>
  `;
}

function renderInventoryTab() {
  const stockByProduct = new Map();
  for (const s of state.inventoryStock) {
    stockByProduct.set(s.product_id, (stockByProduct.get(s.product_id) ?? 0) + Number(s.quantity || 0));
  }

  const productOpts = state.inventoryProducts
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`)
    .join('');

  return `
    <div class="grid-3">
      <article class="card">
        <div class="card-head"><h3>Nuevo Producto</h3></div>
        <form id="area-product-form" class="list-stack">
          <label class="field"><span>Nombre</span><input type="text" name="name" required placeholder="Ej. Avena"></label>
          <div class="field-row">
            <label class="field"><span>Unidad</span><input type="text" name="unit" value="g" required></label>
            <label class="field"><span>Precio ref. (MXN)</span><input type="number" name="reference_price" min="0" step="0.01" placeholder="45"></label>
            <label class="field"><span>Mínimo alerta</span><input type="number" name="minimum_quantity" min="0" value="100"></label>
          </div>
          <button type="submit" class="btn btn-primary btn-sm">Crear Producto</button>
        </form>
      </article>

      <article class="card">
        <div class="card-head"><h3>Registrar / Ajustar Stock</h3></div>
        <form id="area-stock-form" class="list-stack">
          <label class="field"><span>Producto</span><select name="product_id" required>${productOpts || '<option value="">Sin productos</option>'}</select></label>
          <label class="field"><span>Cantidad</span><input type="number" name="quantity" min="0.01" step="0.01" required></label>
          <button type="submit" class="btn btn-primary btn-sm" ${!productOpts ? 'disabled' : ''}>Registrar Stock</button>
        </form>
      </article>

      <article class="card">
        <div class="card-head"><h3>Registrar Consumo</h3></div>
        <form id="area-consume-form" class="list-stack">
          <label class="field"><span>Producto</span><select name="product_id" required>${productOpts || '<option value="">Sin productos</option>'}</select></label>
          <label class="field"><span>Cantidad consumida</span><input type="number" name="quantity" min="0.01" step="0.01" required></label>
          <label class="field"><span>Motivo</span><input type="text" name="reason" value="Consumo diario"></label>
          <button type="submit" class="btn btn-secondary btn-sm" ${!productOpts ? 'disabled' : ''}>Descontar Stock</button>
        </form>
      </article>
    </div>

    <article class="card">
      <div class="card-head"><h3>Catálogo y Existencias Actuales (${state.inventoryProducts.length} productos)</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Producto</th><th>Unidad</th><th>Costo unitario</th><th>Existencia</th><th>Estado</th></tr></thead>
          <tbody>
            ${state.inventoryProducts
              .map((p) => {
                const hasStock = stockByProduct.has(p.id);
                const qty = hasStock ? stockByProduct.get(p.id) : null;
                const priceText =
                  p.reference_price_minor !== null && p.reference_price_minor !== undefined
                    ? `$${(p.reference_price_minor / 100).toFixed(2)} ${p.currency || 'MXN'}`
                    : 'N/D';
                const low = hasStock && qty <= p.minimum_quantity;
                const badge = !hasStock
                  ? '<span class="badge">UNKNOWN</span>'
                  : low
                  ? '<span class="badge badge-warn">Reabastecer</span>'
                  : '<span class="badge badge-ok">Disponible</span>';
                return `
                  <tr>
                    <td><strong>${escapeHtml(p.name)}</strong></td>
                    <td>${escapeHtml(p.unit)}</td>
                    <td class="mono">${escapeHtml(priceText)}</td>
                    <td class="mono">${hasStock ? escapeHtml(qty) : 'UNKNOWN'}</td>
                    <td>${badge}</td>
                  </tr>
                `;
              })
              .join('') || '<tr><td colspan="5">Sin productos registrados en inventario.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

export async function renderAreasView(contentEl) {
  await loadAreasData();
  let body = '';
  if (state.areasSubTab === 'finance') body = renderFinanceTab();
  else if (state.areasSubTab === 'projects') body = renderProjectsTab();
  else if (state.areasSubTab === 'habits') body = renderHabitsTab();
  else body = renderInventoryTab();

  contentEl.innerHTML = `
    <div class="subtabs" role="tablist" aria-label="Áreas manuales">
      ${SUBTABS.map(([id, label]) => `
        <button type="button" class="subtab ${state.areasSubTab === id ? 'active' : ''}" data-area-tab="${id}">${escapeHtml(label)}</button>
      `).join('')}
    </div>
    ${body}
  `;
}

export async function handleAreasClick(e, rerender) {
  const tabBtn = e.target.closest('[data-area-tab]');
  if (tabBtn) {
    state.areasSubTab = tabBtn.dataset.areaTab;
    await rerender();
    return true;
  }

  const editCancel = e.target.closest('.area-edit-cancel-btn');
  if (editCancel) {
    state.editingGoalId = null;
    state.editingProjectId = null;
    state.editingTaskId = null;
    await rerender();
    return true;
  }

  const goalEditToggle = e.target.closest('.area-goal-edit-toggle');
  if (goalEditToggle) {
    const id = goalEditToggle.dataset.id;
    state.editingGoalId = state.editingGoalId === id ? null : id;
    await rerender();
    return true;
  }

  const projEditToggle = e.target.closest('.area-proj-edit-toggle');
  if (projEditToggle) {
    const id = projEditToggle.dataset.id;
    state.editingProjectId = state.editingProjectId === id ? null : id;
    await rerender();
    return true;
  }

  const taskEditToggle = e.target.closest('.area-task-edit-toggle');
  if (taskEditToggle) {
    const id = taskEditToggle.dataset.id;
    state.editingTaskId = state.editingTaskId === id ? null : id;
    await rerender();
    return true;
  }

  const goalDel = e.target.closest('.area-goal-del-btn');
  if (goalDel) {
    await apiFetch(`/api/goals/${encodeURIComponent(goalDel.dataset.id)}`, { method: 'DELETE' });
    showToast('Meta archivada.', { type: 'ok' });
    await rerender();
    return true;
  }

  const projDel = e.target.closest('.area-proj-del-btn');
  if (projDel) {
    await apiFetch(`/api/projects/${encodeURIComponent(projDel.dataset.id)}`, { method: 'DELETE' });
    showToast('Proyecto archivado.', { type: 'ok' });
    await rerender();
    return true;
  }

  const taskDone = e.target.closest('.area-task-done-btn');
  if (taskDone) {
    await apiFetch(`/api/tasks/${encodeURIComponent(taskDone.dataset.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'COMPLETED' }),
    });
    showToast('Tarea completada.', { type: 'ok' });
    await rerender();
    return true;
  }

  const taskDel = e.target.closest('.area-task-del-btn');
  if (taskDel) {
    await apiFetch(`/api/tasks/${encodeURIComponent(taskDel.dataset.id)}`, { method: 'DELETE' });
    showToast('Tarea archivada.', { type: 'ok' });
    await rerender();
    return true;
  }

  const occBtn = e.target.closest('.area-habit-occ-btn');
  if (occBtn) {
    const card = occBtn.closest('.habit-occ-card');
    const note = card?.querySelector('.habit-occ-note')?.value?.trim() || '';
    await apiFetch(`/api/habits/${encodeURIComponent(occBtn.dataset.id)}/occurrences`, {
      method: 'POST',
      body: JSON.stringify({
        scheduled_date: todayLocalIso(state.health?.timezone),
        status: occBtn.dataset.status,
        ...(note ? { notes: note } : {}),
      }),
    });
    showToast(`Hábito registrado (${occBtn.dataset.status}).`, { type: 'ok' });
    await rerender();
    return true;
  }

  return false;
}

export async function handleAreasChange(e, rerender) {
  if (e.target.id === 'area-tx-filter') {
    state.financeTypeFilter = e.target.value;
    await rerender();
    return true;
  }
  return false;
}

export async function handleAreasSubmit(form, rerender) {
  const fd = new FormData(form);
  if (form.id === 'area-account-form') {
    await apiFetch('/api/finance/accounts', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        account_type: fd.get('account_type'),
        currency: fd.get('currency'),
      }),
    });
    showToast('Cuenta creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-income-form') {
    await apiFetch('/api/finance/income', {
      method: 'POST',
      body: JSON.stringify({
        account_id: fd.get('account_id'),
        amount: Number(fd.get('amount')),
        category: fd.get('category'),
        description: fd.get('description'),
      }),
    });
    showToast('Ingreso registrado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-expense-form') {
    await apiFetch('/api/finance/expense', {
      method: 'POST',
      body: JSON.stringify({
        account_id: fd.get('account_id'),
        amount: Number(fd.get('amount')),
        category: fd.get('category'),
        description: fd.get('description'),
      }),
    });
    showToast('Gasto registrado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-goal-form') {
    const resourceImpact = buildResourceImpactFromForm(fd);
    await apiFetch('/api/goals', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        horizon: fd.get('horizon') || 'SHORT',
        ...(resourceImpact ? { resourceImpact } : {}),
      }),
    });
    showToast('Meta creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.classList.contains('area-goal-edit-form')) {
    const id = form.dataset.id;
    const resourceImpact = buildResourceImpactFromForm(fd);
    const targetDate = fd.get('target_date');
    await apiFetch(`/api/goals/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: fd.get('name'),
        horizon: fd.get('horizon'),
        target_date: targetDate ? targetDate : null,
        resourceImpact,
      }),
    });
    state.editingGoalId = null;
    showToast('Meta actualizada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-project-form') {
    const startDate = fd.get('start_date');
    const targetDate = fd.get('target_date');
    await apiFetch('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        ...(startDate ? { start_date: startDate } : {}),
        ...(targetDate ? { target_date: targetDate } : {}),
      }),
    });
    showToast('Proyecto creado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.classList.contains('area-proj-edit-form')) {
    const id = form.dataset.id;
    await apiFetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: fd.get('name'),
        status: fd.get('status'),
        start_date: fd.get('start_date') || null,
        target_date: fd.get('target_date') || null,
      }),
    });
    state.editingProjectId = null;
    showToast('Proyecto actualizado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-task-form') {
    const projectId = fd.get('project_id');
    const dueDate = fd.get('due_date');
    const urgency = fd.get('urgency');
    await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: fd.get('title'),
        ...(projectId ? { project_id: projectId } : {}),
        ...(dueDate ? { due_date: dueDate } : {}),
        ...(urgency ? { urgency: Number(urgency) } : {}),
      }),
    });
    showToast('Tarea creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.classList.contains('area-task-edit-form')) {
    const id = form.dataset.id;
    await apiFetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: fd.get('title'),
        status: fd.get('status'),
        due_date: fd.get('due_date') || null,
        urgency: Number(fd.get('urgency') || 3),
      }),
    });
    state.editingTaskId = null;
    showToast('Tarea actualizada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-habit-form') {
    const freqType = fd.get('freq_type') || 'DAILY';
    const weekdays = fd.getAll('weekdays').map(Number);
    const frequency = freqType === 'SPECIFIC_DAYS' ? { type: 'SPECIFIC_DAYS', weekdays } : { type: 'DAILY' };
    await apiFetch('/api/habits', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        category: fd.get('category') || 'health',
        frequency,
      }),
    });
    showToast('Hábito creado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-routine-form') {
    await apiFetch('/api/routines', { method: 'POST', body: JSON.stringify({ name: fd.get('name') }) });
    showToast('Rutina creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-product-form') {
    const refPrice = fd.get('reference_price');
    await apiFetch('/api/inventory/products', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        unit: fd.get('unit'),
        minimum_quantity: Number(fd.get('minimum_quantity') || 0),
        ...(refPrice !== null && String(refPrice).trim() !== ''
          ? { reference_price: Number(refPrice), currency: 'MXN' }
          : {}),
      }),
    });
    showToast('Producto creado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-stock-form') {
    await apiFetch('/api/inventory/stock', {
      method: 'POST',
      body: JSON.stringify({
        product_id: fd.get('product_id'),
        quantity: Number(fd.get('quantity')),
      }),
    });
    showToast('Stock registrado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-consume-form') {
    await apiFetch('/api/inventory/consumption', {
      method: 'POST',
      body: JSON.stringify({
        product_id: fd.get('product_id'),
        quantity: Number(fd.get('quantity')),
        reason: fd.get('reason') || 'Consumo diario',
      }),
    });
    showToast('Consumo registrado.', { type: 'ok' });
    await rerender();
    return true;
  }
  return false;
}
