import { apiFetch, DAY_NAMES, escapeHtml, showToast, todayLocalIso } from '../api.js';
import { state } from '../state.js';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CALENDAR_TYPE_LABELS = {
  important_date: 'Fecha importante',
  recurring_payment: 'Pago recurrente',
  financial_commitment: 'Compromiso económico',
  calendar_event: 'Evento',
  time_commitment: 'Compromiso horario',
  weekly_baseline: 'Semana sellada',
};

export async function renderDashboardView(contentEl) {
  const refDate = todayLocalIso(state.health?.timezone);
  const [habitsMood, projectsGoals, calendar] = await Promise.all([
    apiFetch(`/api/dashboard/habits-mood?to=${encodeURIComponent(refDate)}`),
    apiFetch(`/api/dashboard/projects-goals?referenceDate=${encodeURIComponent(refDate)}`),
    apiFetch(`/api/dashboard/calendar?year=${state.calendarYear}&month=${state.calendarMonth}`),
  ]);

  state.dashHabitsMood = habitsMood;
  state.dashProjectsGoals = projectsGoals;
  state.dashCalendar = calendar;

  const moodSum = habitsMood.moodSummary || {};
  const pgSum = projectsGoals.summary || {};
  const currencies = Object.values(projectsGoals.financeSummary?.currencies || {});
  const calItems = calendar.items || [];
  const calDays = calendar.days || [];

  contentEl.innerHTML = `
    <div class="stats-grid">
      <div class="stat-box">
        <span>ÁNIMO PROMEDIO (30D)</span>
        <strong>${moodSum.averageMood !== null && moodSum.averageMood !== undefined ? `${escapeHtml(moodSum.averageMood)}/5` : 'Sin datos'}</strong>
        <small>${moodSum.entriesCount ?? 0} registros · Estrés ${moodSum.averageStress ?? '-'}</small>
      </div>
      <div class="stat-box">
        <span>METAS Y PROYECTOS</span>
        <strong>${pgSum.activeGoals ?? 0} / ${pgSum.activeProjects ?? 0}</strong>
        <small>Tareas pendientes: ${pgSum.pendingTasks ?? 0} · Bloqueadas: ${pgSum.blockedTasks ?? 0}</small>
      </div>
      <div class="stat-box">
        <span>FINANZAS DISPONIBLES</span>
        <strong>${currencies.length > 0 ? `$${escapeHtml(currencies[0].available_money)} ${escapeHtml(currencies[0].currency)}` : '$0 MXN'}</strong>
        <small>${currencies.length > 0 ? `Saldo calc: $${escapeHtml(currencies[0].calculated_balance)}` : 'Sin cuentas registradas'}</small>
      </div>
      <div class="stat-box">
        <span>EVENTOS DEL MES</span>
        <strong>${calendar.totalItems ?? 0}</strong>
        <small>${escapeHtml(MONTH_NAMES[(calendar.month || 1) - 1])} ${escapeHtml(calendar.year)}</small>
      </div>
    </div>

    <div class="grid-2">
      <article class="card">
        <div class="card-head">
          <div>
            <h2>Hábitos y Bienestar Emocional</h2>
            <small>${escapeHtml(habitsMood.period?.from || '')} a ${escapeHtml(habitsMood.period?.to || '')}</small>
          </div>
          <span class="badge badge-accent">${habitsMood.habitsSummary?.length ?? 0} hábitos activos</span>
        </div>

        ${(moodSum.topTriggers || []).length > 0 ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
            ${moodSum.topTriggers.slice(0, 6).map((t) => `<span class="badge">${escapeHtml(t.trigger)} (${t.count})</span>`).join('')}
          </div>
        ` : ''}

        <div class="list-stack">
          ${(habitsMood.habitsSummary || []).map((h) => `
            <div class="list-row">
              <div>
                <strong>${escapeHtml(h.name)}</strong>
                <div style="font-size:11px;color:var(--text-secondary);">
                  Racha actual: ${h.currentStreak} · Mejor: ${h.bestStreak} · Sin confirmar: ${h.counts?.UNKNOWN ?? 0}
                </div>
              </div>
              <span class="badge ${h.completionRateOfKnown !== null && h.completionRateOfKnown >= 0.7 ? 'badge-ok' : 'badge-warn'}">
                ${h.completionRateOfKnown !== null ? `${Math.round(h.completionRateOfKnown * 100)}%` : 'N/D'}
              </span>
            </div>
          `).join('') || '<small style="color:var(--text-secondary);">Sin hábitos activos registrados aún.</small>'}
        </div>

        <div id="dashboard-svg-habits-slot" style="margin-top:12px;">
          <div class="mini-matrix">
            ${(habitsMood.dailyMatrix || []).slice(-7).map((d) => `
              <div class="mini-cell">
                <div class="mono" style="font-size:10px;color:var(--text-muted);">${escapeHtml(d.date.slice(5))}</div>
                <div>Ánimo: <strong>${d.mood ? `${d.mood.mood_score}/5` : '-'}</strong></div>
                <div style="font-size:11px;color:var(--text-secondary);">✓${d.habits.completed} ✕${d.habits.missed} ?${d.habits.unknown}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </article>

      <article class="card">
        <div class="card-head">
          <div>
            <h2>Proyectos, Metas y Factibilidad</h2>
            <small>Estado consolidado al ${escapeHtml(projectsGoals.referenceDate || refDate)}</small>
          </div>
          ${projectsGoals.feasibility ? `
            <span class="badge ${projectsGoals.feasibility.isFeasible ? 'badge-ok' : 'badge-err'}">
              ${projectsGoals.feasibility.isFeasible ? 'Carga Factible' : 'Colisión de Recursos'}
            </span>
          ` : '<span class="badge">Sin perfil configurado</span>'}
        </div>

        <div id="dashboard-svg-projects-slot" class="list-stack">
          ${(projectsGoals.projects || []).map((p) => {
            const pct = p.task_completion_ratio !== null ? Math.round(p.task_completion_ratio * 100) : 0;
            return `
              <div class="list-row">
                <div>
                  <strong>${escapeHtml(p.name)}</strong>
                  <div style="font-size:11px;color:var(--text-secondary);">
                    ${p.completed_tasks}/${p.total_active_tasks} tareas · Vencidas: ${p.overdueTasksCount}
                  </div>
                </div>
                <span class="badge badge-accent">${pct}%</span>
              </div>
            `;
          }).join('') || '<small style="color:var(--text-secondary);">Sin proyectos activos en este momento.</small>'}
        </div>

        ${(projectsGoals.goals || []).length > 0 ? `
          <div style="margin-top:14px;">
            <div class="eyebrow" style="margin-bottom:8px;">Metas (${projectsGoals.goals.length})</div>
            <div class="list-stack">
              ${projectsGoals.goals.slice(0, 5).map((g) => `
                <div class="list-row">
                  <span>${escapeHtml(g.name)}</span>
                  <span class="badge">${escapeHtml(g.status)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <div>
          <h2>Calendario Maestro — ${escapeHtml(MONTH_NAMES[(calendar.month || 1) - 1])} ${escapeHtml(calendar.year)}</h2>
          <small>Cumpleaños, pagos recurrentes, compromisos financieros, eventos locales y semanas selladas</small>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <button type="button" class="btn btn-secondary btn-sm" id="dash-cal-prev-btn">◀ Mes anterior</button>
          <button type="button" class="btn btn-secondary btn-sm" id="dash-cal-next-btn">Mes siguiente ▶</button>
        </div>
      </div>

      <div id="dashboard-calendar-grid" class="mini-matrix" style="margin-bottom:14px;">
        ${calDays.map((d) => `
          <div class="mini-cell ${d.isSaturday ? 'is-saturday' : ''}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong class="mono">${escapeHtml(String(d.dayOfMonth).padStart(2, '0'))}</strong>
              <span style="font-size:10px;color:var(--text-muted);">${escapeHtml((DAY_NAMES[d.dayOfWeek] || '').slice(0, 3))}</span>
            </div>
            <div style="font-size:11px;color:${d.items.length > 0 ? 'var(--accent-soft)' : 'var(--text-muted)'};margin-top:4px;">
              ${d.items.length > 0 ? `${d.items.length} ítem(s)` : 'Libre'}
            </div>
          </div>
        `).join('')}
      </div>

      ${calItems.length > 0 ? `
        <div class="list-stack">
          ${calItems.map((item) => {
            const typeLabel = CALENDAR_TYPE_LABELS[item.type] || item.type;
            let extra = '';
            if (item.type === 'important_date' && item.metadata?.turnsAge !== undefined) {
              extra = ` · Cumple ${item.metadata.turnsAge} años`;
            } else if (item.type === 'recurring_payment') {
              extra = ` · $${item.metadata.amount} (${item.metadata.paid ? 'Pagado' : 'Pendiente'})`;
            } else if (item.type === 'calendar_event' && item.metadata?.startTime) {
              extra = ` · ${item.metadata.startTime}`;
            }
            return `
              <div class="list-row">
                <span><strong class="mono">${escapeHtml(item.date)}</strong> · ${escapeHtml(item.title)}<small style="color:var(--text-secondary);">${escapeHtml(extra)}</small></span>
                <span class="badge ${item.metadata?.paid === false ? 'badge-warn' : 'badge-accent'}">${escapeHtml(typeLabel)}</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : '<small style="color:var(--text-secondary);">Sin eventos, cumpleaños o pagos registrados en este mes.</small>'}
    </article>
  `;
}

export async function handleDashboardClick(e, rerender) {
  if (e.target.id === 'dash-cal-prev-btn') {
    if (state.calendarMonth === 1) {
      state.calendarMonth = 12;
      state.calendarYear -= 1;
    } else {
      state.calendarMonth -= 1;
    }
    await rerender();
    return true;
  }

  if (e.target.id === 'dash-cal-next-btn') {
    if (state.calendarMonth === 12) {
      state.calendarMonth = 1;
      state.calendarYear += 1;
    } else {
      state.calendarMonth += 1;
    }
    await rerender();
    return true;
  }

  return false;
}

export function notifyDashboardPlaceholder() {
  showToast('Calendario actualizado.', { type: 'ok' });
}
