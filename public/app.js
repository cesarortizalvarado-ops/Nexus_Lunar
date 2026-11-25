import { apiFetch, isTodaySaturday, showToast } from './js/api.js';
import { createChatPanelController } from './js/chat-panel.js';
import { state } from './js/state.js';
import { handleDashboardChange, handleDashboardClick, handleDashboardSubmit, renderDashboardView } from './js/views/dashboard-view.js';
import { handleAreasChange, handleAreasClick, handleAreasSubmit, renderAreasView } from './js/views/areas-view.js';
import { handleSpacesChange, handleSpacesClick, handleSpacesSubmit, renderSpacesView } from './js/views/spaces-view.js';
import { handleLibrariesClick, handleLibrariesSubmit, renderLibrariesView } from './js/views/libraries-view.js';
import { handlePlanChange, handlePlanClick, handlePlanSubmit, renderPlanView } from './js/views/plan-view.js';
import { handleSystemClick, renderSystemView } from './js/views/system-view.js';

const VIEW_META = {
  dashboard: { label: 'PANEL VISUAL Y CALENDARIO MAESTRO', title: 'Panel Visual' },
  areas: { label: 'ÁREAS MANUALES', title: 'Finanzas, Metas, Hábitos e Inventario' },
  spaces: { label: 'PERFIL Y MINI-APPS', title: 'Perfil Personal, Biometría, Clínico y Fechas' },
  libraries: { label: 'BIBLIOTECAS Y REFERENCIAS', title: 'Bibliotecas, Recetas y Catálogo' },
  plan: { label: 'PLAN SEMANAL Y SÁBADO', title: 'Semana Activa y Ritual del Sábado' },
  system: { label: 'SISTEMA Y RESPALDOS', title: 'Sistema, Doctor y Respaldos Locales' },
};

const VIEW_ORDER = ['dashboard', 'areas', 'spaces', 'libraries', 'plan', 'system'];

const shellEl = document.getElementById('app-shell');
const contentEl = document.getElementById('view-content');
const sectionNameEl = document.getElementById('section-name');
const pageTitleEl = document.getElementById('page-title');
const healthChipTextEl = document.getElementById('health-chip-text');
const sidebarStatusDotEl = document.getElementById('sidebar-status-dot');
const sidebarStatusTextEl = document.getElementById('sidebar-status-text');
const footerVersionEl = document.getElementById('footer-version');
const planSatBadgeEl = document.getElementById('plan-sat-badge');
const mainNavEl = document.getElementById('main-nav');
const toggleCopilotBtnEl = document.getElementById('toggle-copilot-btn');

function updatePlanSaturdayBadge() {
  if (!planSatBadgeEl) return;
  const shouldShow = isTodaySaturday(state.health) || Boolean(state.saturdayReview);
  planSatBadgeEl.classList.toggle('hidden', !shouldShow);
  planSatBadgeEl.textContent = state.saturdayReview ? 'BORRADOR' : 'SÁB';
}

function toggleCopilotPanel(forceOpen = null) {
  if (!shellEl) return;
  const currentlyCollapsed = shellEl.classList.contains('copilot-collapsed');
  const nextCollapsed = forceOpen === null ? !currentlyCollapsed : !forceOpen;
  shellEl.classList.toggle('copilot-collapsed', nextCollapsed);
  if (toggleCopilotBtnEl) {
    toggleCopilotBtnEl.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
  }
}

async function refreshGlobalStatus() {
  try {
    const [health, catalog] = await Promise.all([
      apiFetch('/health'),
      state.catalog ? Promise.resolve(state.catalog) : apiFetch('/api/spaces/catalog').catch(() => null),
    ]);
    state.health = health;
    if (catalog) state.catalog = catalog;
    healthChipTextEl.textContent = `v${health.schema_version} · ${health.system_status}`;
    sidebarStatusDotEl.className = 'status-dot';
    sidebarStatusTextEl.textContent = `Núcleo ${health.system_status}`;
    footerVersionEl.textContent = `${health.version} · esquema v${health.schema_version} · ${health.timezone}`;
    updatePlanSaturdayBadge();
  } catch (err) {
    sidebarStatusDotEl.className = 'status-dot err';
    sidebarStatusTextEl.textContent = 'Núcleo sin conexión';
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
}

async function renderCurrentView() {
  try {
    if (state.currentView === 'dashboard') await renderDashboardView(contentEl);
    else if (state.currentView === 'areas') await renderAreasView(contentEl);
    else if (state.currentView === 'spaces') await renderSpacesView(contentEl);
    else if (state.currentView === 'libraries') await renderLibrariesView(contentEl);
    else if (state.currentView === 'plan') await renderPlanView(contentEl);
    else if (state.currentView === 'system') await renderSystemView(contentEl);
    updatePlanSaturdayBadge();
  } catch (err) {
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

const chatController = createChatPanelController({
  onSwitchView: (view) => switchView(view),
  onDataChanged: async ({ silentViewRefresh = false } = {}) => {
    updatePlanSaturdayBadge();
    if (!silentViewRefresh) {
      await renderCurrentView();
    }
  },
});

contentEl.addEventListener('click', async (e) => {
  try {
    const jumpBtn = e.target.closest('[data-jump-view]');
    if (jumpBtn) {
      switchView(jumpBtn.dataset.jumpView);
      return;
    }

    if (state.currentView === 'dashboard' && (await handleDashboardClick(e, renderCurrentView))) return;
    if (state.currentView === 'areas' && (await handleAreasClick(e, renderCurrentView))) return;
    if (state.currentView === 'spaces' && (await handleSpacesClick(e, renderCurrentView))) return;
    if (state.currentView === 'libraries' && (await handleLibrariesClick(e, renderCurrentView))) return;
    if (
      state.currentView === 'plan' &&
      (await handlePlanClick(e, renderCurrentView, async () => {
        updatePlanSaturdayBadge();
        await renderCurrentView();
      }))
    ) {
      return;
    }
    if (state.currentView === 'system') await handleSystemClick(e, renderCurrentView);
  } catch (err) {
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
});

contentEl.addEventListener('change', async (e) => {
  try {
    if (state.currentView === 'dashboard' && (await handleDashboardChange(e, renderCurrentView))) return;
    if (state.currentView === 'areas' && (await handleAreasChange(e, renderCurrentView))) return;
    if (state.currentView === 'spaces' && handleSpacesChange(e)) return;
    if (state.currentView === 'plan') await handlePlanChange(e, renderCurrentView);
  } catch (err) {
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
});

contentEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    if (state.currentView === 'dashboard' && (await handleDashboardSubmit(form, renderCurrentView))) return;
    if (state.currentView === 'areas' && (await handleAreasSubmit(form, renderCurrentView))) return;
    if (state.currentView === 'spaces' && (await handleSpacesSubmit(form, renderCurrentView))) return;
    if (state.currentView === 'libraries' && (await handleLibrariesSubmit(form, renderCurrentView))) return;
    if (state.currentView === 'plan') await handlePlanSubmit(form, renderCurrentView, updatePlanSaturdayBadge);
  } catch (err) {
    showToast(err.message, { type: 'err', remediation: err.remediation });
  }
});

mainNavEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.nav-tab');
  if (btn?.dataset.view) switchView(btn.dataset.view);
});

mainNavEl.addEventListener('keydown', (e) => {
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return;
  e.preventDefault();
  const idx = VIEW_ORDER.indexOf(state.currentView);
  const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
  const nextView = VIEW_ORDER[(idx + delta + VIEW_ORDER.length) % VIEW_ORDER.length];
  switchView(nextView);
  document.getElementById(`tab-${nextView}`)?.focus();
});

document.addEventListener('keydown', (e) => {
  if (!e.altKey) return;
  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    toggleCopilotPanel();
    return;
  }
  const index = Number(e.key) - 1;
  if (Number.isInteger(index) && index >= 0 && index < VIEW_ORDER.length) {
    e.preventDefault();
    switchView(VIEW_ORDER[index]);
  }
});

document.getElementById('sidebar-toggle').addEventListener('click', (e) => {
  const collapsed = shellEl.classList.toggle('sidebar-collapsed');
  e.currentTarget.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
});

toggleCopilotBtnEl?.addEventListener('click', () => toggleCopilotPanel());
document.getElementById('close-copilot-btn')?.addEventListener('click', () => toggleCopilotPanel(false));

document.getElementById('refresh-btn').addEventListener('click', async () => {
  await refreshGlobalStatus();
  await renderCurrentView();
  await chatController.init();
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

if (window.innerWidth < 1180) {
  toggleCopilotPanel(false);
}

await refreshGlobalStatus();
await Promise.all([renderCurrentView(), chatController.init()]);
