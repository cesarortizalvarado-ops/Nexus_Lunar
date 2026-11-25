const contentEl = document.getElementById('view-content');
const sectionNameEl = document.getElementById('section-name');
const noticeEl = document.getElementById('notice');
const footerVersionEl = document.getElementById('footer-version');

let currentView = 'overview';

function showNotice(msg, isError = false) {
  noticeEl.textContent = msg;
  noticeEl.hidden = false;
  noticeEl.className = isError ? 'notice error' : 'notice';
  setTimeout(() => { noticeEl.hidden = true; }, 4500);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.description ?? body?.errors?.[0]?.description ?? 'Error en solicitud.');
  return body.data ?? body;
}

// Cliente desacoplado sobre el contrato universal OperationRequest/OperationResponse (F08)
async function dispatchOp(operation_type, payload = {}, extra = {}) {
  const res = await fetch('/api/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation_type, payload, ...extra }),
  });
  const resp = await res.json();
  if (!res.ok || !resp.success) {
    const err = resp.errors?.[0];
    throw new Error(err?.description ?? 'Operación rechazada por el núcleo.');
  }
  return resp.result;
}

function escapeHtml(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function renderOverview() {
  const [health, tasks, habits, plans, catalog] = await Promise.all([
    api('/health'),
    dispatchOp('tasks.list'),
    dispatchOp('habits.list'),
    dispatchOp('planning.plans.list'),
    api('/api/operations/catalog'),
  ]);
  footerVersionEl.textContent = `${health.version} (esquema v${health.schema_version} · ${health.timezone})`;
  contentEl.innerHTML = `
    <div class="stats">
      <article class="stat"><span>ESTADO DEL NÚCLEO</span><strong>${escapeHtml(health.system_status)}</strong><small>Esquema v${health.schema_version} · ${escapeHtml(health.timezone)}</small></article>
      <article class="stat"><span>TAREAS</span><strong>${tasks.length}</strong><small>Gestión personal</small></article>
      <article class="stat"><span>HÁBITOS</span><strong>${habits.length}</strong><small>Dominio propio</small></article>
      <article class="stat"><span>PLANES</span><strong>${plans.length}</strong><small>${catalog.length} operaciones en catálogo</small></article>
    </div>
    <article class="panel"><h3>Arquitectura Consolidada</h3><p>Operación 100% local en 127.0.0.1, sin modelos de IA reales ni transmisión externa. Web y CLI consumen exclusivamente el catálogo declarativo de <code>OperationDispatcher</code>.</p></article>
  `;
}

async function renderMemory() {
  const items = await dispatchOp('memory.search');
  contentEl.innerHTML = `
    <article class="panel">
      <h3>Nuevo registro de memoria</h3>
      <form id="mem-form" class="form-row">
        <select name="information_type"><option value="USER_STATEMENT">USER_STATEMENT</option><option value="FACT">FACT</option><option value="PREFERENCE">PREFERENCE</option><option value="DECISION">DECISION</option><option value="UNKNOWN">UNKNOWN</option></select>
        <input name="content" required placeholder="Contenido del registro">
        <button class="primary" type="submit">Guardar</button>
      </form>
    </article>
    <article class="panel"><h3>Registros (${items.length})</h3>${items.map(i => `<div class="row"><span><b>[${escapeHtml(i.information_type)}]</b> ${escapeHtml(i.content)}</span><small>${escapeHtml(i.status)} · v${i.version}</small></div>`).join('') || '<p>Sin registros.</p>'}</article>
  `;
  document.getElementById('mem-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await dispatchOp('memory.create', Object.fromEntries(fd));
    showNotice('Registro de memoria creado.');
    renderCurrent();
  };
}

async function renderPersonal() {
  const [goals, projects, tasks] = await Promise.all([
    dispatchOp('goals.list'),
    dispatchOp('projects.list'),
    dispatchOp('tasks.list'),
  ]);
  contentEl.innerHTML = `
    <article class="panel">
      <h3>Crear tarea</h3>
      <form id="task-form" class="form-row">
        <input name="title" required placeholder="Título de la tarea">
        <button class="primary" type="submit">Crear tarea</button>
      </form>
    </article>
    <article class="panel"><h3>Objetivos (${goals.length})</h3>${goals.map(g => `<div class="row"><span>${escapeHtml(g.name)}</span><small>[${escapeHtml(g.status)}]</small></div>`).join('') || '<p>Sin objetivos.</p>'}</article>
    <article class="panel"><h3>Proyectos (${projects.length})</h3>${projects.map(p => `<div class="row"><span>${escapeHtml(p.name)}</span><small>[${escapeHtml(p.status)}]</small></div>`).join('') || '<p>Sin proyectos.</p>'}</article>
    <article class="panel"><h3>Tareas (${tasks.length})</h3>${tasks.map(t => `<div class="row"><span>${escapeHtml(t.title)}</span><small>[${escapeHtml(t.status)}${t.estimated_duration_minutes ? ` · est ${t.estimated_duration_minutes}m` : ''}${t.actual_duration_minutes ? ` · real ${t.actual_duration_minutes}m` : ''}]</small></div>`).join('') || '<p>Sin tareas.</p>'}</article>
  `;
  document.getElementById('task-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await dispatchOp('tasks.create', Object.fromEntries(fd));
    showNotice('Tarea creada.');
    renderCurrent();
  };
}

async function renderTime() {
  const [events, avail] = await Promise.all([
    dispatchOp('calendar.listEvents'),
    dispatchOp('availability.list'),
  ]);
  contentEl.innerHTML = `
    <article class="panel"><h3>Eventos (${events.length})</h3>${events.map(e => `<div class="row"><span>${escapeHtml(e.title)} · ${escapeHtml(e.start_at)} → ${escapeHtml(e.end_at)}</span><small>[${escapeHtml(e.status)} · ${escapeHtml(e.timezone)}]</small></div>`).join('') || '<p>Sin eventos.</p>'}</article>
    <article class="panel"><h3>Ventanas de disponibilidad (${avail.windows.length})</h3><p><small>Política de periodos no registrados: ${escapeHtml(avail.unregistered_time_policy)}</small></p>${avail.windows.map(w => `<div class="row"><span>[${escapeHtml(w.availability_type)}]</span><small>${escapeHtml(w.start_at)} → ${escapeHtml(w.end_at)}</small></div>`).join('') || '<p>Sin ventanas registradas.</p>'}</article>
  `;
}

async function renderHabits() {
  const [habits, routines] = await Promise.all([
    dispatchOp('habits.list'),
    dispatchOp('routines.list'),
  ]);
  contentEl.innerHTML = `
    <article class="panel">
      <h3>Nuevo hábito diario</h3>
      <form id="hab-form" class="form-row">
        <input name="name" required placeholder="Nombre del hábito">
        <button class="primary" type="submit">Crear hábito</button>
      </form>
    </article>
    <article class="panel"><h3>Hábitos (${habits.length})</h3>${habits.map(h => `<div class="row"><span>${escapeHtml(h.name)}</span><small>[${escapeHtml(h.frequency.type)} · ${escapeHtml(h.status)}]</small></div>`).join('') || '<p>Sin hábitos.</p>'}</article>
    <article class="panel"><h3>Rutinas (${routines.length})</h3>${routines.map(r => `<div class="row"><span>${escapeHtml(r.name)}</span><small>(${r.steps.length} pasos · v${r.version})</small></div>`).join('') || '<p>Sin rutinas.</p>'}</article>
  `;
  document.getElementById('hab-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await dispatchOp('habits.create', { name: fd.get('name'), frequency: { type: 'DAILY' } });
    showNotice('Hábito creado.');
    renderCurrent();
  };
}

async function renderResources() {
  const [summary, products] = await Promise.all([
    dispatchOp('finance.summary'),
    dispatchOp('inventory.products.list'),
  ]);
  contentEl.innerHTML = `
    <article class="panel"><h3>Resumen financiero</h3><pre>${escapeHtml(JSON.stringify(summary, null, 2))}</pre></article>
    <article class="panel"><h3>Productos e inventario (${products.length})</h3>${products.map(p => `<div class="row"><span>${escapeHtml(p.name)}</span><small>unidad: ${escapeHtml(p.unit)} · mín: ${p.minimum_quantity}</small></div>`).join('') || '<p>Sin productos.</p>'}</article>
  `;
}

async function renderKnowledge() {
  const [libs, formats] = await Promise.all([
    dispatchOp('knowledge.libraries.list'),
    dispatchOp('knowledge.formats'),
  ]);
  contentEl.innerHTML = `
    <article class="panel"><h3>Bibliotecas de conocimiento (${libs.length})</h3><p><small>Independientes de la memoria personal · Formatos: ${escapeHtml(formats.join(', '))}</small></p>${libs.map(l => `<div class="row"><span>${escapeHtml(l.name)}</span><small>[${escapeHtml(l.status)}]</small></div>`).join('') || '<p>Sin bibliotecas.</p>'}</article>
  `;
}

async function renderPlanning() {
  const [plans, review, suggestions] = await Promise.all([
    dispatchOp('planning.plans.list'),
    api('/api/planning/review'),
    dispatchOp('adaptation.suggestions.list'),
  ]);
  contentEl.innerHTML = `
    <article class="panel">
      <h3>Generar preagenda determinista</h3>
      <form id="plan-form" class="form-row">
        <input name="week_start" type="date" required value="${escapeHtml(review.review_date)}">
        <input name="week_end" type="date" required value="${escapeHtml(review.review_date)}">
        <button class="primary" type="submit">Generar propuesta</button>
      </form>
    </article>
    <article class="panel"><h3>Planes (${plans.length})</h3>${plans.map(p => `<div class="row"><span>${escapeHtml(p.name)}</span><small>[${escapeHtml(p.plan_type)} · ${escapeHtml(p.status)}]</small></div>`).join('') || '<p>Sin planes.</p>'}</article>
    <article class="panel"><h3>Cierre diario (${escapeHtml(review.review_date)})</h3><p>${escapeHtml(review.summary_text)}</p></article>
    <article class="panel">
      <div class="panel-head"><h3>Sugerencias adaptativas (${suggestions.length})</h3><button class="secondary" id="btn-analyze">Detectar patrones</button></div>
      ${suggestions.map(s => `<div class="row"><span><b>${escapeHtml(s.suggestion_type)}</b> — ${escapeHtml(s.explanation?.proposed_change ?? '')}</span><small>[${escapeHtml(s.status)}]</small></div>`).join('') || '<p>Sin sugerencias registradas.</p>'}
    </article>
  `;
  document.getElementById('plan-form').onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await dispatchOp('planning.generateWeekly', Object.fromEntries(fd));
    showNotice('Propuesta determinista generada.');
    renderCurrent();
  };
  document.getElementById('btn-analyze').onclick = async () => {
    await dispatchOp('adaptation.identifyPatterns');
    await dispatchOp('adaptation.generateSuggestions');
    showNotice('Análisis adaptativo ejecutado.');
    renderCurrent();
  };
}

async function renderSystem() {
  const [modules, backups, ai] = await Promise.all([
    dispatchOp('modules.list'),
    dispatchOp('backup.list'),
    api('/api/ai/status'),
  ]);
  contentEl.innerHTML = `
    <article class="panel"><h3>Módulos registrados (${modules.length})</h3>${modules.map(m => `<div class="row"><span><b>${escapeHtml(m.id)}</b> — ${escapeHtml(m.name)}</span><small>[${escapeHtml(m.status)}]</small></div>`).join('')}</article>
    <article class="panel"><div class="panel-head"><h3>Respaldos (${backups.length})</h3><button class="primary" id="btn-backup">Crear respaldo ahora</button></div><pre>${escapeHtml(JSON.stringify(backups.slice(0, 5), null, 2))}</pre></article>
    <article class="panel"><h3>Estado de capacidades preparadas (IA · SecretStore · CIO)</h3><pre>${escapeHtml(JSON.stringify(ai, null, 2))}</pre></article>
  `;
  document.getElementById('btn-backup').onclick = async () => {
    await dispatchOp('backup.create', { reason: 'web-manual' });
    showNotice('Respaldo verificado creado.');
    renderCurrent();
  };
}

const VIEWS = {
  overview: ['RESUMEN', renderOverview],
  memory: ['MEMORIA PERSONAL', renderMemory],
  personal: ['GESTIÓN PERSONAL', renderPersonal],
  time: ['TIEMPO Y DISPONIBILIDAD', renderTime],
  habits: ['HÁBITOS Y RUTINAS', renderHabits],
  resources: ['FINANZAS E INVENTARIO', renderResources],
  knowledge: ['BIBLIOTECAS', renderKnowledge],
  planning: ['PLANIFICACIÓN · CIERRE · ADAPTACIÓN', renderPlanning],
  system: ['SISTEMA · RESPALDOS · IA PREPARADA', renderSystem],
};

async function renderCurrent() {
  const [label, fn] = VIEWS[currentView] ?? VIEWS.overview;
  sectionNameEl.textContent = label;
  try {
    await fn();
  } catch (err) {
    showNotice(err.message, true);
  }
}

document.querySelectorAll('.nav').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.nav').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    renderCurrent();
  };
});

document.getElementById('refresh').onclick = renderCurrent;
renderCurrent();
