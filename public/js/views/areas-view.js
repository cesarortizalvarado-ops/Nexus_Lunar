import { apiFetch, escapeHtml, showToast, todayLocalIso } from '../api.js';
import { state } from '../state.js';

const SUBTABS = [
  ['finance', 'Finanzas'],
  ['projects', 'Proyectos, Metas y Tareas'],
  ['habits', 'Hábitos y Rutinas'],
  ['inventory', 'Inventario'],
];

async function loadAreasData() {
  const [summary, accounts, transactions, goals, projects, tasks, habits, routines, products, stock] = await Promise.all([
    apiFetch('/api/finance/summary'),
    apiFetch('/api/finance/accounts'),
    apiFetch('/api/finance/transactions'),
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

function renderFinanceTab() {
  const currencies = Object.values(state.financeSummary?.currencies || {});
  const accountOpts = state.financeAccounts
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`)
    .join('');

  return `
    <div class="stats-grid">
      ${currencies.map((c) => `
        <div class="stat-box">
          <span>BALANCE ${escapeHtml(c.currency)}</span>
          <strong>$${escapeHtml(c.calculated_balance)}</strong>
          <small>Disponible: $${escapeHtml(c.available_money)} · Ing: $${escapeHtml(c.total_income)} / Gas: $${escapeHtml(c.total_expense)}</small>
        </div>
      `).join('') || '<div class="stat-box"><span>FINANZAS</span><strong>Sin cuentas</strong><small>Crea una cuenta para empezar</small></div>'}
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
      <div class="card-head"><h3>Movimientos Recientes (${state.financeTransactions.length})</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Descripción</th><th>Monto</th></tr></thead>
          <tbody>
            ${state.financeTransactions.slice(0, 15).map((tx) => `
              <tr>
                <td class="mono">${escapeHtml(String(tx.occurred_at || '').slice(0, 10))}</td>
                <td><span class="badge ${tx.transaction_type === 'INCOME' ? 'badge-ok' : 'badge-warn'}">${escapeHtml(tx.transaction_type)}</span></td>
                <td>${escapeHtml(tx.category)}</td>
                <td>${escapeHtml(tx.description)}</td>
                <td class="mono">$${escapeHtml(tx.amount)} ${escapeHtml(tx.currency)}</td>
              </tr>
            `).join('') || '<tr><td colspan="5">Sin transacciones registradas.</td></tr>'}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderProjectsTab() {
  return `
    <div class="grid-3">
      <article class="card">
        <div class="card-head"><h3>Metas (${state.goals.length})</h3></div>
        <form id="area-goal-form" style="display:flex;gap:8px;margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nueva meta...">
          <button type="submit" class="btn btn-primary btn-sm">Crear</button>
        </form>
        <div class="list-stack">
          ${state.goals.map((g) => `
            <div class="list-row">
              <span>${escapeHtml(g.name)}</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="badge">${escapeHtml(g.status)}</span>
                ${g.status === 'ACTIVE' ? `<button type="button" class="btn btn-secondary btn-sm area-goal-status-btn" data-id="${escapeHtml(g.id)}" data-status="ON_HOLD">Pausar</button>` : ''}
                ${g.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-danger btn-sm area-goal-del-btn" data-id="${escapeHtml(g.id)}">Archivar</button>` : ''}
              </div>
            </div>
          `).join('') || '<small>Sin metas.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Proyectos (${state.projects.length})</h3></div>
        <form id="area-project-form" style="display:flex;gap:8px;margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nuevo proyecto...">
          <button type="submit" class="btn btn-primary btn-sm">Crear</button>
        </form>
        <div class="list-stack">
          ${state.projects.map((p) => `
            <div class="list-row">
              <span>${escapeHtml(p.name)}</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="badge">${escapeHtml(p.status)}</span>
                ${p.status === 'PLANNING' ? `<button type="button" class="btn btn-secondary btn-sm area-proj-status-btn" data-id="${escapeHtml(p.id)}" data-status="ACTIVE">Activar</button>` : ''}
                ${p.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-danger btn-sm area-proj-del-btn" data-id="${escapeHtml(p.id)}">Archivar</button>` : ''}
              </div>
            </div>
          `).join('') || '<small>Sin proyectos.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Tareas (${state.tasks.length})</h3></div>
        <form id="area-task-form" class="list-stack" style="margin-bottom:12px;">
          <input type="text" name="title" required placeholder="Nueva tarea...">
          <select name="project_id">
            <option value="">Sin proyecto vinculado</option>
            ${state.projects.filter((p) => p.status !== 'ARCHIVED').map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-primary btn-sm">Crear Tarea</button>
        </form>
        <div class="list-stack">
          ${state.tasks.map((t) => `
            <div class="list-row">
              <span>${escapeHtml(t.title)}</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <span class="badge ${t.status === 'COMPLETED' ? 'badge-ok' : ''}">${escapeHtml(t.status)}</span>
                ${t.status !== 'COMPLETED' && t.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-secondary btn-sm area-task-done-btn" data-id="${escapeHtml(t.id)}">Completar</button>` : ''}
                ${t.status !== 'ARCHIVED' ? `<button type="button" class="btn btn-danger btn-sm area-task-del-btn" data-id="${escapeHtml(t.id)}">Archivar</button>` : ''}
              </div>
            </div>
          `).join('') || '<small>Sin tareas.</small>'}
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
        <form id="area-habit-form" style="display:flex;gap:8px;margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nuevo hábito diario...">
          <button type="submit" class="btn btn-primary btn-sm">Crear Hábito</button>
        </form>
        <div class="list-stack">
          ${state.habits.map((h) => `
            <div class="list-row">
              <div>
                <strong>${escapeHtml(h.name)}</strong>
                <div style="font-size:11px;color:var(--text-secondary);">${escapeHtml(h.frequency?.type || 'DAILY')} · ${escapeHtml(h.status)}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-primary btn-sm area-habit-occ-btn" data-id="${escapeHtml(h.id)}" data-status="COMPLETED">Hoy ✓</button>
                <button type="button" class="btn btn-secondary btn-sm area-habit-occ-btn" data-id="${escapeHtml(h.id)}" data-status="MISSED">Hoy ✕</button>
              </div>
            </div>
          `).join('') || '<small>Sin hábitos registrados.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Rutinas (${state.routines.length})</h3></div>
        <form id="area-routine-form" style="display:flex;gap:8px;margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nueva rutina...">
          <button type="submit" class="btn btn-primary btn-sm">Crear Rutina</button>
        </form>
        <div class="list-stack">
          ${state.routines.map((r) => `
            <div class="list-row">
              <span>${escapeHtml(r.name)}</span>
              <span class="badge">${escapeHtml(r.status)}</span>
            </div>
          `).join('') || '<small>Sin rutinas registradas.</small>'}
        </div>
      </article>
    </div>
  `;
}

function renderInventoryTab() {
  const productMap = new Map(state.inventoryProducts.map((p) => [p.id, p]));
  const productOpts = state.inventoryProducts
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`)
    .join('');

  return `
    <div class="grid-3">
      <article class="card">
        <div class="card-head"><h3>Nuevo Producto</h3></div>
        <form id="area-product-form" class="list-stack">
          <label class="field"><span>Nombre</span><input type="text" name="name" required placeholder="Ej. Avena"></label>
          <label class="field"><span>Unidad</span><input type="text" name="unit" value="g" required></label>
          <label class="field"><span>Mínimo alerta</span><input type="number" name="minimum_quantity" min="0" value="100"></label>
          <button type="submit" class="btn btn-primary btn-sm">Crear Producto</button>
        </form>
      </article>

      <article class="card">
        <div class="card-head"><h3>Registrar Stock</h3></div>
        <form id="area-stock-form" class="list-stack">
          <label class="field"><span>Producto</span><select name="product_id" required>${productOpts || '<option value="">Sin productos</option>'}</select></label>
          <label class="field"><span>Cantidad</span><input type="number" name="quantity" min="0.01" step="0.01" required></label>
          <button type="submit" class="btn btn-primary btn-sm" ${!productOpts ? 'disabled' : ''}>Agregar Stock</button>
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
      <div class="card-head"><h3>Existencias Actuales (${state.inventoryStock.length})</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Producto</th><th>Ubicación</th><th>Cantidad</th><th>Unidad</th></tr></thead>
          <tbody>
            ${state.inventoryStock.map((s) => {
              const prod = productMap.get(s.product_id);
              return `
                <tr>
                  <td>${escapeHtml(prod?.name || s.product_id)}</td>
                  <td>${escapeHtml(s.location || 'default')}</td>
                  <td class="mono">${escapeHtml(s.quantity)}</td>
                  <td>${escapeHtml(s.unit || prod?.unit || '')}</td>
                </tr>
              `;
            }).join('') || '<tr><td colspan="4">Sin registros de inventario.</td></tr>'}
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

  const goalStatus = e.target.closest('.area-goal-status-btn');
  if (goalStatus) {
    await apiFetch(`/api/goals/${encodeURIComponent(goalStatus.dataset.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: goalStatus.dataset.status }),
    });
    showToast('Estado de meta actualizado.', { type: 'ok' });
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

  const projStatus = e.target.closest('.area-proj-status-btn');
  if (projStatus) {
    await apiFetch(`/api/projects/${encodeURIComponent(projStatus.dataset.id)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: projStatus.dataset.status }),
    });
    showToast('Proyecto actualizado.', { type: 'ok' });
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
    await apiFetch(`/api/habits/${encodeURIComponent(occBtn.dataset.id)}/occurrences`, {
      method: 'POST',
      body: JSON.stringify({
        scheduled_date: todayLocalIso(state.health?.timezone),
        status: occBtn.dataset.status,
      }),
    });
    showToast(`Hábito registrado (${occBtn.dataset.status}).`, { type: 'ok' });
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
    await apiFetch('/api/goals', { method: 'POST', body: JSON.stringify({ name: fd.get('name') }) });
    showToast('Meta creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-project-form') {
    await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name: fd.get('name') }) });
    showToast('Proyecto creado.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-task-form') {
    const projectId = fd.get('project_id');
    await apiFetch('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: fd.get('title'),
        ...(projectId ? { project_id: projectId } : {}),
      }),
    });
    showToast('Tarea creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'area-habit-form') {
    await apiFetch('/api/habits', {
      method: 'POST',
      body: JSON.stringify({ name: fd.get('name'), frequency: { type: 'DAILY' } }),
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
    await apiFetch('/api/inventory/products', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        unit: fd.get('unit'),
        minimum_quantity: Number(fd.get('minimum_quantity') || 0),
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
