import { apiFetch, DAY_NAMES, escapeHtml, showToast, todayLocalIso } from '../api.js';
import {
  renderHabitsMoodHeatmap,
  renderMoodEnergySparkline,
  renderProgressBarSvg,
} from '../charts-svg.js';
import { state } from '../state.js';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const MOOD_LABELS = [
  ['great', 'Excelente'],
  ['good', 'Bien'],
  ['calm', 'Tranquilo'],
  ['focused', 'Enfocado'],
  ['neutral', 'Neutral'],
  ['tired', 'Cansado'],
  ['stressed', 'Estresado'],
  ['anxious', 'Ansioso'],
  ['low', 'Bajo'],
  ['very_low', 'Muy bajo'],
];

const CALENDAR_TYPE_LABELS = {
  important_date: 'Fecha importante',
  recurring_payment: 'Pago recurrente',
  financial_commitment: 'Compromiso económico',
  calendar_event: 'Evento',
  time_commitment: 'Compromiso horario',
  weekly_baseline: 'Semana sellada',
};

function subtractDaysIso(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  return dt.toISOString().slice(0, 10);
}

function renderDayInspectorHtml(dailyMatrix, selectedDate) {
  if (!selectedDate) {
    return '<div class="day-inspector"><small style="color:var(--text-secondary);">Haz clic en cualquier celda del mapa de calor para inspeccionar hábitos fallados, estado de ánimo, disparadores y notas de ese día.</small></div>';
  }
  const day = dailyMatrix.find((d) => d.date === selectedDate);
  if (!day) {
    return '<div class="day-inspector"><small>Día fuera del rango actual.</small></div>';
  }

  return `
    <div class="day-inspector" id="dash-day-inspector">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong>Inspector del día · <span class="mono">${escapeHtml(day.date)}</span> (${escapeHtml(DAY_NAMES[day.dayOfWeek] || '')})</strong>
        <span class="badge">Completados: ${day.habits.completed} · Fallados: ${day.habits.missed + day.habits.skipped} · Sin confirmar (UNKNOWN): ${day.habits.unknown}</span>
      </div>
      ${
        day.mood
          ? `
        <div style="font-size:13px;">
          Ánimo: <strong>${escapeHtml(day.mood.mood_score)}/5</strong> (${escapeHtml(day.mood.mood_label)}) ·
          Energía: <strong>${escapeHtml(day.mood.energy_level)}/5</strong> ·
          Estrés: <strong>${escapeHtml(day.mood.stress_level)}/5</strong>
          ${day.mood.triggers?.length ? `<div style="margin-top:4px;">Disparadores: ${day.mood.triggers.map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
          ${day.mood.notes ? `<div style="margin-top:4px;color:var(--text-secondary);">Nota: ${escapeHtml(day.mood.notes)}</div>` : ''}
        </div>
      `
          : '<small style="color:var(--text-secondary);">Sin check-in emocional registrado para este día.</small>'
      }
      ${
        day.failures?.length
          ? `
        <div class="list-stack">
          ${day.failures
            .map(
              (f) => `
            <div class="alert-banner warn">
              <span><strong>${escapeHtml(f.habitName)}</strong> (${escapeHtml(f.status)})</span>
              <small>${escapeHtml(f.notes || 'Sin nota registrada')}</small>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : '<small style="color:var(--text-secondary);">Sin fallos registrados (MISSED/SKIPPED) en este día.</small>'
      }
    </div>
  `;
}

function renderCalendarGrid(calendar) {
  const days = calendar.days || [];
  if (!days.length) return '';
  const firstDow = days[0].dayOfWeek ?? 0;
  const pads = Array.from({ length: firstDow }, () => '<div class="cal-day-cell pad" aria-hidden="true"></div>').join('');

  const cells = days
    .map((d) => {
      const isSelected = d.date === state.selectedCalendarDate;
      const tags = (d.items || [])
        .slice(0, 3)
        .map((it) => {
          const paidCls = it.type === 'recurring_payment' && it.metadata?.paid ? 'paid' : '';
          const suffix =
            it.type === 'important_date' && it.metadata?.turnsAge !== undefined
              ? ` (${it.metadata.turnsAge}a)`
              : it.type === 'recurring_payment'
              ? ` $${it.metadata.amount}`
              : '';
          return `<div class="cal-tag type-${escapeHtml(it.type)} ${paidCls}" title="${escapeHtml(it.title + suffix)}">${escapeHtml(it.title + suffix)}</div>`;
        })
        .join('');
      const moreCount = (d.items?.length ?? 0) - 3;
      return `
        <button type="button" class="cal-day-cell ${d.isSaturday ? 'is-saturday' : ''} ${isSelected ? 'selected' : ''}" data-calendar-date="${escapeHtml(d.date)}">
          <div class="cal-day-top">
            <strong class="mono">${escapeHtml(String(d.dayOfMonth).padStart(2, '0'))}</strong>
            ${d.isSaturday ? '<span class="badge badge-warn">Sáb</span>' : ''}
          </div>
          <div class="cal-tag-list">
            ${tags}
            ${moreCount > 0 ? `<small style="font-size:10px;color:var(--text-muted);">+${moreCount} más</small>` : ''}
          </div>
        </button>
      `;
    })
    .join('');

  return `
    <div class="cal-weekdays" aria-hidden="true">
      ${DAY_NAMES.map((name) => `<div class="cal-weekday-head">${escapeHtml(name.slice(0, 3))}</div>`).join('')}
    </div>
    <div class="cal-month-grid">${pads}${cells}</div>
  `;
}

function renderCalendarInspectorHtml(calendar, selectedDate) {
  if (!selectedDate) {
    return '<div class="day-inspector"><small style="color:var(--text-secondary);">Haz clic en cualquier fecha del calendario mensual para inspeccionar cumpleaños, pagos, eventos y bloques de ese día.</small></div>';
  }
  const day = (calendar.days || []).find((d) => d.date === selectedDate);
  if (!day) {
    return '<div class="day-inspector"><small>Fecha fuera del mes mostrado.</small></div>';
  }
  return `
    <div class="day-inspector" id="dash-calendar-inspector">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong>Detalle del <span class="mono">${escapeHtml(day.date)}</span> (${escapeHtml(DAY_NAMES[day.dayOfWeek] || '')})</strong>
        ${day.isSaturday ? '<span class="badge badge-warn">Día de Ritual Semanal del Sábado</span>' : ''}
      </div>
      ${
        day.items.length > 0
          ? `
        <div class="list-stack">
          ${day.items
            .map((item) => {
              const typeLabel = CALENDAR_TYPE_LABELS[item.type] || item.type;
              let detail = '';
              if (item.type === 'important_date' && item.metadata?.turnsAge !== undefined) {
                detail = `Cumple ${item.metadata.turnsAge} años`;
              } else if (item.type === 'recurring_payment') {
                detail = `$${item.metadata.amount} (${item.metadata.frequency}) · ${item.metadata.paid ? 'Pagado' : 'Pendiente'}`;
              } else if (item.type === 'calendar_event' && item.metadata?.startTime) {
                detail = `${item.metadata.startTime}–${item.metadata.endTime || ''}`;
              } else if (item.type === 'weekly_baseline') {
                detail = `Ejecuciones: ${item.metadata.executionsCount} · Revisiones: ${item.metadata.revisionsCount}`;
              }
              return `
                <div class="list-row">
                  <span><strong>${escapeHtml(item.title)}</strong>${detail ? ` <small style="color:var(--text-secondary);">· ${escapeHtml(detail)}</small>` : ''}</span>
                  <span class="badge ${item.metadata?.paid === false ? 'badge-warn' : 'badge-accent'}">${escapeHtml(typeLabel)}</span>
                </div>
              `;
            })
            .join('')}
        </div>
      `
          : '<small style="color:var(--text-secondary);">Sin eventos, cumpleaños o pagos programados en esta fecha.</small>'
      }
    </div>
  `;
}

function formatGoalResourceSummary(goal) {
  const ri = goal.resourceImpact;
  if (!ri) return 'Sin impacto de recursos configurado';
  const parts = [];
  if (ri.financial?.periodicContribution) {
    parts.push(`$${ri.financial.periodicContribution}/${ri.financial.frequency || 'biweekly'}${ri.financial.targetAmount ? ` (meta $${ri.financial.targetAmount})` : ''}`);
  }
  if (ri.time?.weeklyHoursRequired) {
    parts.push(`${ri.time.weeklyHoursRequired} h/sem`);
  }
  if (ri.health?.metricType) {
    parts.push(`${ri.health.metricType}: ${ri.health.targetMetric ?? '-'} (Δ ${ri.health.weeklyTargetDelta ?? 0}/sem)`);
  }
  return parts.join(' · ') || 'Impacto configurado';
}

export async function renderDashboardView(contentEl) {
  const refDate = todayLocalIso(state.health?.timezone);
  const fromDate = subtractDaysIso(refDate, Math.max(1, state.habitsMoodDays - 1));

  const [habitsMood, projectsGoals, calendar] = await Promise.all([
    apiFetch(`/api/dashboard/habits-mood?from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(refDate)}`),
    apiFetch(`/api/dashboard/projects-goals?referenceDate=${encodeURIComponent(refDate)}`),
    apiFetch(`/api/dashboard/calendar?year=${state.calendarYear}&month=${state.calendarMonth}`),
  ]);

  state.dashHabitsMood = habitsMood;
  state.dashProjectsGoals = projectsGoals;
  state.dashCalendar = calendar;

  if (!state.selectedHeatmapDate || !(habitsMood.dailyMatrix || []).some((d) => d.date === state.selectedHeatmapDate)) {
    state.selectedHeatmapDate = refDate;
  }
  if (!state.selectedCalendarDate || !(calendar.days || []).some((d) => d.date === state.selectedCalendarDate)) {
    state.selectedCalendarDate = (calendar.days || []).find((d) => d.date === refDate)?.date || calendar.days?.[0]?.date || null;
  }

  const moodSum = habitsMood.moodSummary || {};
  const pgSum = projectsGoals.summary || {};
  const currencies = Object.values(projectsGoals.financeSummary?.currencies || {});
  const matrix = habitsMood.dailyMatrix || [];
  const todayMood = matrix.find((d) => d.date === refDate)?.mood || null;
  const feasibility = projectsGoals.feasibility;

  const showWellbeing = state.dashboardSection === 'all' || state.dashboardSection === 'wellbeing';
  const showProjects = state.dashboardSection === 'all' || state.dashboardSection === 'projects';
  const showCalendar = state.dashboardSection === 'all' || state.dashboardSection === 'calendar';

  contentEl.innerHTML = `
    <div class="subtabs" role="tablist" aria-label="Secciones de Panel Visual">
      <button type="button" class="subtab ${state.dashboardSection === 'all' ? 'active' : ''}" data-dash-section="all">Vista Completa</button>
      <button type="button" class="subtab ${state.dashboardSection === 'wellbeing' ? 'active' : ''}" data-dash-section="wellbeing">Hábitos y Emociones</button>
      <button type="button" class="subtab ${state.dashboardSection === 'projects' ? 'active' : ''}" data-dash-section="projects">Proyectos, Metas y Factibilidad</button>
      <button type="button" class="subtab ${state.dashboardSection === 'calendar' ? 'active' : ''}" data-dash-section="calendar">Calendario Maestro</button>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <span>ÁNIMO PROMEDIO (${state.habitsMoodDays}D)</span>
        <strong>${moodSum.averageMood !== null && moodSum.averageMood !== undefined ? `${escapeHtml(moodSum.averageMood)}/5` : 'Sin datos'}</strong>
        <small>${moodSum.entriesCount ?? 0} registros · Energía ${moodSum.averageEnergy ?? '-'} · Estrés ${moodSum.averageStress ?? '-'}</small>
      </div>
      <div class="stat-box">
        <span>METAS / PROYECTOS</span>
        <strong>${pgSum.activeGoals ?? 0} / ${pgSum.activeProjects ?? 0}</strong>
        <small>Pendientes: ${pgSum.pendingTasks ?? 0} · Completadas: ${pgSum.completedTasks ?? 0} · Bloqueadas: ${pgSum.blockedTasks ?? 0}</small>
      </div>
      <div class="stat-box">
        <span>DISPONIBLE EN FINANZAS</span>
        <strong>${currencies.length > 0 ? `$${escapeHtml(currencies[0].available_money)} ${escapeHtml(currencies[0].currency)}` : '$0 MXN'}</strong>
        <small>${currencies.length > 0 ? `Saldo calc: $${escapeHtml(currencies[0].calculated_balance)}` : 'Sin cuentas registradas'}</small>
      </div>
      <div class="stat-box">
        <span>CALENDARIO DEL MES</span>
        <strong>${calendar.totalItems ?? 0} ítems</strong>
        <small>${escapeHtml(MONTH_NAMES[(calendar.month || 1) - 1])} ${escapeHtml(calendar.year)}</small>
      </div>
    </div>

    ${
      showWellbeing
        ? `
      <article class="card">
        <div class="card-head">
          <div>
            <h2>Check-in Emocional Rápido + Hábitos</h2>
            <small>Rango ${escapeHtml(habitsMood.period?.from || '')} a ${escapeHtml(habitsMood.period?.to || '')}</small>
          </div>
          <label class="field" style="min-width:175px;">
            <span>Ventana temporal</span>
            <select id="dash-range-select">
              <option value="14" ${state.habitsMoodDays === 14 ? 'selected' : ''}>Últimos 14 días</option>
              <option value="30" ${state.habitsMoodDays === 30 ? 'selected' : ''}>Últimos 30 días</option>
              <option value="60" ${state.habitsMoodDays === 60 ? 'selected' : ''}>Últimos 60 días</option>
            </select>
          </label>
        </div>

        <form id="dash-mood-checkin-form" class="panel-elevated" style="margin-bottom:14px;">
          <div class="field-row">
            <label class="field"><span>Fecha</span><input type="date" name="entry_date" value="${escapeHtml(refDate)}" required></label>
            <label class="field"><span>Ánimo (1–5)</span><input type="number" name="mood_score" min="1" max="5" value="${escapeHtml(todayMood?.mood_score ?? 4)}" required></label>
            <label class="field"><span>Energía (1–5)</span><input type="number" name="energy_level" min="1" max="5" value="${escapeHtml(todayMood?.energy_level ?? 4)}" required></label>
            <label class="field"><span>Estrés (1–5)</span><input type="number" name="stress_level" min="1" max="5" value="${escapeHtml(todayMood?.stress_level ?? 2)}" required></label>
            <label class="field"><span>Etiqueta</span>
              <select name="mood_label">
                ${MOOD_LABELS.map(([val, lbl]) => `<option value="${val}" ${todayMood?.mood_label === val ? 'selected' : ''}>${escapeHtml(lbl)}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="field-row" style="margin-top:10px;align-items:end;">
            <label class="field"><span>Disparadores (coma)</span><input type="text" name="triggers" value="${escapeHtml((todayMood?.triggers || []).join(', '))}" placeholder="sueño, ejercicio, trabajo"></label>
            <label class="field"><span>Nota breve</span><input type="text" name="notes" value="${escapeHtml(todayMood?.notes ?? '')}" placeholder="Observación emocional del día..."></label>
            <button type="submit" class="btn btn-primary btn-sm">Guardar Check-in</button>
          </div>
        </form>

        <div class="grid-2">
          <div>
            <div class="eyebrow" style="margin-bottom:8px;">Heatmap Hábitos + Ánimo (clic en un día)</div>
            ${renderHabitsMoodHeatmap(matrix, { selectedDate: state.selectedHeatmapDate })}
          </div>
          <div>
            <div class="eyebrow" style="margin-bottom:8px;">Tendencia Ánimo (violeta) vs Energía (esmeralda)</div>
            ${renderMoodEnergySparkline(matrix)}
          </div>
        </div>

        ${renderDayInspectorHtml(matrix, state.selectedHeatmapDate)}

        <div class="table-wrap" style="margin-top:14px;">
          <table>
            <thead>
              <tr><th>Hábito</th><th>Racha actual</th><th>Mejor racha</th><th>Tasa (conocidos)</th><th>UNKNOWN</th><th>Fallos</th></tr>
            </thead>
            <tbody>
              ${(habitsMood.habitsSummary || [])
                .map(
                  (h) => `
                <tr>
                  <td><strong>${escapeHtml(h.name)}</strong></td>
                  <td class="mono">${escapeHtml(h.currentStreak)}</td>
                  <td class="mono">${escapeHtml(h.bestStreak)}</td>
                  <td class="mono">${h.completionRateOfKnown !== null ? `${Math.round(h.completionRateOfKnown * 100)}%` : 'N/D'}</td>
                  <td class="mono">${escapeHtml(h.counts?.UNKNOWN ?? 0)}</td>
                  <td class="mono">${escapeHtml((h.counts?.MISSED ?? 0) + (h.counts?.SKIPPED ?? 0))}</td>
                </tr>
              `
                )
                .join('') || '<tr><td colspan="6">Sin hábitos activos en el sistema.</td></tr>'}
            </tbody>
          </table>
        </div>
      </article>
    `
        : ''
    }

    ${
      showProjects
        ? `
      <article class="card">
        <div class="card-head">
          <div>
            <h2>Avance de Proyectos, Metas y Factibilidad</h2>
            <small>Cálculo determinista SIN porcentaje artificial (INV-007)</small>
          </div>
          ${
            feasibility
              ? `<span class="badge ${feasibility.isFeasible ? 'badge-ok' : 'badge-err'}">${feasibility.isFeasible ? 'Plan Factible' : 'Colisión Detectada'}</span>`
              : '<span class="badge">Configura tu perfil en Espacios para evaluar factibilidad</span>'
          }
        </div>

        ${
          feasibility
            ? `
          <div class="alert-banner ${feasibility.isFeasible ? 'ok' : 'err'}" style="margin-bottom:14px;">
            <span>
              ${
                feasibility.isFeasible
                  ? `Metas viables: carga ${feasibility.totals?.weeklyHoursRequired ?? 0} h/sem y $${feasibility.totals?.biweeklyContributionRequired ?? 0} quincenales.`
                  : `Colisión de recursos: ${(feasibility.conflicts || []).map((c) => c.message || c.type).join(' · ') || 'Metas exceden capacidad disponible.'}`
              }
            </span>
          </div>
        `
            : ''
        }

        <div class="grid-2">
          <div>
            <div class="eyebrow" style="margin-bottom:8px;">Proyectos Activos (${projectsGoals.projects?.length ?? 0})</div>
            <div class="list-stack">
              ${(projectsGoals.projects || [])
                .map((p) => {
                  const hasTasks = p.total_active_tasks > 0;
                  const ratioLabel = hasTasks ? `${Math.round((p.task_completion_ratio ?? 0) * 100)}%` : 'Sin tareas';
                  return `
                  <div class="panel-elevated">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px;">
                      <strong>${escapeHtml(p.name)}</strong>
                      <div style="display:flex;gap:6px;">
                        ${p.overdueTasksCount > 0 ? `<span class="badge badge-err">${p.overdueTasksCount} vencidas</span>` : ''}
                        <span class="badge">${escapeHtml(p.completed_tasks)}/${escapeHtml(p.total_active_tasks)} tareas</span>
                      </div>
                    </div>
                    ${renderProgressBarSvg(hasTasks ? p.task_completion_ratio : null, ratioLabel)}
                    ${!hasTasks ? '<small style="color:var(--text-secondary);">INV-007: proyecto sin tareas activas no muestra avance artificial.</small>' : ''}
                  </div>
                `;
                })
                .join('') || '<small style="color:var(--text-secondary);">Sin proyectos activos.</small>'}
            </div>
          </div>

          <div>
            <div class="eyebrow" style="margin-bottom:8px;">Metas e Impacto en Recursos (${projectsGoals.goals?.length ?? 0})</div>
            <div class="list-stack">
              ${(projectsGoals.goals || [])
                .map(
                  (g) => `
                <div class="panel-elevated">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <strong>${escapeHtml(g.name)}</strong>
                    <span class="badge">${escapeHtml(g.status)}</span>
                  </div>
                  <small style="color:var(--text-secondary);">${escapeHtml(formatGoalResourceSummary(g))}</small>
                </div>
              `
                )
                .join('') || '<small style="color:var(--text-secondary);">Sin metas registradas.</small>'}
            </div>
          </div>
        </div>
      </article>
    `
        : ''
    }

    ${
      showCalendar
        ? `
      <article class="card">
        <div class="card-head">
          <div>
            <h2>Calendario Maestro Interactivo — ${escapeHtml(MONTH_NAMES[(calendar.month || 1) - 1])} ${escapeHtml(calendar.year)}</h2>
            <small>Cumpleaños (turnsAge), pagos recurrentes, compromisos, eventos y sábados de revisión</small>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" id="dash-cal-prev-btn">← Mes anterior</button>
            <button type="button" class="btn btn-secondary btn-sm" id="dash-cal-today-btn">Hoy</button>
            <button type="button" class="btn btn-secondary btn-sm" id="dash-cal-next-btn">Mes siguiente →</button>
          </div>
        </div>

        ${renderCalendarGrid(calendar)}
        ${renderCalendarInspectorHtml(calendar, state.selectedCalendarDate)}
      </article>
    `
        : ''
    }
  `;
}

export async function handleDashboardClick(e, rerender) {
  const secBtn = e.target.closest('[data-dash-section]');
  if (secBtn) {
    state.dashboardSection = secBtn.dataset.dashSection;
    await rerender();
    return true;
  }

  const heatmapCell = e.target.closest('[data-heatmap-date]');
  if (heatmapCell) {
    state.selectedHeatmapDate = heatmapCell.dataset.heatmapDate;
    await rerender();
    return true;
  }

  const calCell = e.target.closest('[data-calendar-date]');
  if (calCell) {
    state.selectedCalendarDate = calCell.dataset.calendarDate;
    await rerender();
    return true;
  }

  if (e.target.id === 'dash-cal-prev-btn') {
    if (state.calendarMonth === 1) {
      state.calendarMonth = 12;
      state.calendarYear -= 1;
    } else {
      state.calendarMonth -= 1;
    }
    state.selectedCalendarDate = null;
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
    state.selectedCalendarDate = null;
    await rerender();
    return true;
  }

  if (e.target.id === 'dash-cal-today-btn') {
    const today = todayLocalIso(state.health?.timezone);
    const [y, m] = today.split('-').map(Number);
    state.calendarYear = y;
    state.calendarMonth = m;
    state.selectedCalendarDate = today;
    await rerender();
    return true;
  }

  return false;
}

export async function handleDashboardChange(e, rerender) {
  if (e.target.id === 'dash-range-select') {
    state.habitsMoodDays = Number(e.target.value) || 30;
    await rerender();
    return true;
  }
  return false;
}

export async function handleDashboardSubmit(form, rerender) {
  if (form.id === 'dash-mood-checkin-form') {
    const fd = new FormData(form);
    const triggers = String(fd.get('triggers') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    await apiFetch('/api/wellbeing/moods', {
      method: 'POST',
      body: JSON.stringify({
        entry_date: fd.get('entry_date'),
        mood_score: Number(fd.get('mood_score')),
        energy_level: Number(fd.get('energy_level')),
        stress_level: Number(fd.get('stress_level')),
        mood_label: fd.get('mood_label'),
        triggers,
        notes: fd.get('notes') || '',
      }),
    });
    state.selectedHeatmapDate = fd.get('entry_date');
    showToast('Check-in emocional guardado.', { type: 'ok' });
    await rerender();
    return true;
  }
  return false;
}
