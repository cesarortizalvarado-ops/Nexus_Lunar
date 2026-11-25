import {
  apiFetch,
  DAY_NAMES,
  escapeHtml,
  EXECUTION_STATUSES,
  FALLBACK_EXERCISES,
  formatHour,
  getNextSundayIso,
  isTodaySaturday,
  showToast,
} from '../api.js';
import { state } from '../state.js';

const EXERCISE_DEFAULTS = {
  'ex-walk-brisk': { days: [1, 2, 3, 4, 5], hour: 6.5 },
  'ex-weightlifting-moderate': { days: [1, 3, 5], hour: 18.5 },
  'ex-stationary-bike': { days: [2, 4], hour: 7.5 },
  'ex-mobility-stretch': { days: [0, 6], hour: 8.5 },
};

async function renderActiveWeekSubMode() {
  if (state.baselines.length === 0) {
    state.selectedBaselineId = null;
    state.baselineDetail = null;
    return `
      <div class="empty-state">
        <h3>Aún no hay una Baseline semanal sellada</h3>
        <p>Configura tu perfil en Perfil y Mini-Apps y prepara la semana en Ritual del Sábado.</p>
        <div class="topbar-actions" style="justify-content:center;margin-top:12px;">
          <button type="button" class="btn btn-primary" data-plan-submode="saturday">Ir a Ritual del Sábado</button>
          <button type="button" class="btn btn-secondary" data-jump-view="spaces">Configurar Perfil</button>
        </div>
      </div>
    `;
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

  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>Baseline Sellada</h2>
          <small style="color:var(--text-secondary);">Plan inmutable protegido con firma criptográfica SHA-256</small>
        </div>
        <label class="field" style="min-width:250px;">
          <span>Seleccionar semana sellada</span>
          <select id="baseline-selector">
            ${state.baselines.map((b) => `<option value="${escapeHtml(b.baselineId)}" ${b.baselineId === baseline.baselineId ? 'selected' : ''}>${escapeHtml(b.baselineId)} (${escapeHtml(b.weekStartDate || '-')})</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="stats-grid">
        <div class="stat-box"><span>ID / SEMANA</span><strong class="mono">${escapeHtml(baseline.baselineId)}</strong><small>Inicio: ${escapeHtml(baseline.plan.weekStartDate)}</small></div>
        <div class="stat-box"><span>SELLO SHA-256</span><strong class="mono" title="${escapeHtml(baseline.integrityHash)}">${escapeHtml(shortHash)}…</strong><small><span class="badge badge-ok">INMUTABLE</span> · ${escapeHtml(baseline.approvedAt.slice(0, 10))}</small></div>
        <div class="stat-box"><span>CUMPLIMIENTO CONFIRMADO</span><strong>${pct}%</strong><small>${analysis.statusCounts.completed} completados de ${analysis.confirmedBlocks} confirmados</small></div>
        <div class="stat-box"><span>BLOQUES SIN CONFIRMAR</span><strong>${analysis.unconfirmedBlocks}</strong><small>Revisiones registradas: ${revisionsLog.length}</small></div>
      </div>
    </article>

    <section class="week-grid" aria-label="Calendario semanal de 7 días">
      ${baseline.plan.dailySchedules
        .map((day) => {
          const nut = day.nutrition;
          const mealText = nut?.mealPlan?.meals
            ? `${nut.mealPlan.meals.breakfast?.name ?? ''} / ${nut.mealPlan.meals.lunch?.name ?? ''} / ${nut.mealPlan.meals.dinner?.name ?? ''}`
            : nut?.hasValidMealPlan
            ? 'Menú asignado'
            : 'Sin menú asignado';
          return `
          <article class="day-column">
            <div class="day-header">
              <h3>${escapeHtml(DAY_NAMES[day.dayOfWeek] ?? `Día ${day.dayOfWeek}`)}</h3>
              <div class="day-nutrition">
                <div>Meta: <strong>${nut?.targetCalories ?? '-'} kcal</strong> · Ej: <strong>${day.exerciseCaloriesBurned ?? 0} kcal</strong></div>
                <div>${escapeHtml(mealText)}</div>
              </div>
            </div>
            <div class="block-list">
              ${day.blocks
                .map((block) => {
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
                    ${
                      isSleep
                        ? ''
                        : `
                      <div class="block-controls">
                        <div class="block-controls-row">
                          <select class="exec-status-select" data-block-id="${escapeHtml(block.id)}" aria-label="Estado de ${escapeHtml(block.title)}">
                            ${EXECUTION_STATUSES.map((st) => `<option value="${st}" ${st === status ? 'selected' : ''}>${st}</option>`).join('')}
                          </select>
                          <button type="button" class="btn btn-secondary btn-sm exec-save-btn" data-block-id="${escapeHtml(block.id)}">Registrar</button>
                        </div>
                        <input type="text" class="exec-reason-input ${status === 'missed_with_reason' ? 'reason-required' : ''}" data-block-id="${escapeHtml(block.id)}" placeholder="${status === 'missed_with_reason' ? 'Motivo obligatorio...' : 'Motivo opcional...'}" value="${escapeHtml(exec?.reason ?? '')}">
                      </div>
                    `
                    }
                  </div>
                `;
                })
                .join('')}
            </div>
          </article>
        `;
        })
        .join('')}
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
          <label class="field"><span>Nuevo día</span>
            <select name="newDayOfWeek">${DAY_NAMES.map((name, idx) => `<option value="${idx}">${name}</option>`).join('')}</select>
          </label>
          <label class="field"><span>Hora inicio (0–24)</span><input type="number" name="newStartHour" step="0.25" min="0" max="23.75" value="19" required></label>
          <label class="field"><span>Hora fin (0–24)</span><input type="number" name="newEndHour" step="0.25" min="0.25" max="24" value="20" required></label>
        </div>
        <div class="field-row" style="margin-top:10px;">
          <label class="field"><span>Motivo de reprogramación</span><input type="text" name="reason" required placeholder="Ej. Movido por lluvia o reunión imprevista"></label>
        </div>
        <div style="margin-top:12px;"><button type="submit" class="btn btn-primary btn-sm">Registrar Reprogramación</button></div>
      </form>
      ${
        revisionsLog.length > 0
          ? `
        <div class="list-stack" style="margin-top:12px;">
          ${revisionsLog
            .map(
              (rev) => `
            <div class="list-row">
              <span><strong>${escapeHtml(rev.originalBlockId)}</strong> → ${escapeHtml(rev.reason)}</span>
              <small class="mono">${rev.newWindow ? `${DAY_NAMES[rev.newWindow.dayOfWeek]} ${formatHour(rev.newWindow.startHour)}–${formatHour(rev.newWindow.endHour)}` : ''}</small>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : ''
      }
    </details>
  `;
}

function renderSaturdayReviewResult(review) {
  const draft = review.nextWeekDraft;
  const pantry = draft.sundayPrep?.pantryReport;
  const prev = review.previousWeekSummary;

  return `
    ${
      prev
        ? `
      <article class="card">
        <div class="card-head">
          <h3>Cierre de Semana Previa (${escapeHtml(prev.baselineId)})</h3>
          <span class="badge badge-accent">${Math.round((prev.confirmedCompletionRate || 0) * 100)}% completado</span>
        </div>
        <p style="margin:0 0 8px;">Bloques confirmados: <strong>${prev.confirmedBlocks}/${prev.totalTrackableBlocks}</strong> · Sin confirmar: <strong>${prev.unconfirmedBlocks}</strong></p>
        ${
          prev.documentedFrictionReasons.length > 0
            ? `
          <div class="list-stack">
            ${prev.documentedFrictionReasons
              .map(
                (f) => `
              <div class="list-row">
                <span>Fricción: <strong>${escapeHtml(f.reason)}</strong></span>
                <span class="badge badge-warn">${f.count}x</span>
              </div>
            `
              )
              .join('')}
          </div>
        `
            : '<small>Sin fricciones registradas en la semana previa.</small>'
        }
      </article>
    `
        : ''
    }

    <article class="card">
      <div class="card-head">
        <h3>Puntos a Confirmar (${review.pendingQuestions.length})</h3>
        <span class="badge ${review.pendingQuestions.length > 0 ? 'badge-warn' : 'badge-ok'}">${review.pendingQuestions.length > 0 ? 'Requiere revisión' : 'Sin alertas'}</span>
      </div>
      ${
        review.pendingQuestions.length > 0
          ? `
        <div class="list-stack">
          ${review.pendingQuestions
            .map(
              (q) => `
            <div class="alert-banner ${q.severity === 'HIGH' || q.severity === 'CRITICAL' ? 'err' : 'warn'}">
              <span><strong>[${escapeHtml(q.severity)}]</strong> ${escapeHtml(q.question)}</span>
              <span class="badge badge-${escapeHtml(q.severity)}">${escapeHtml(q.category)}</span>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : '<p>No hay conflictos ni pagos omitidos pendientes.</p>'
      }
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
            <thead><tr><th>Ingrediente</th><th>Por comprar</th><th>Unidad</th><th>Costo est.</th></tr></thead>
            <tbody>
              ${
                (pantry?.shoppingList || [])
                  .map(
                    (item) => `
                <tr>
                  <td>${escapeHtml(item.itemName)}</td>
                  <td class="mono">${escapeHtml(item.quantityToBuy)}</td>
                  <td>${escapeHtml(item.unit)}</td>
                  <td class="mono">${item.estimatedCost !== null ? `$${item.estimatedCost}` : 'N/D'}</td>
                </tr>
              `
                  )
                  .join('') || '<tr><td colspan="4">Despensa cubierta o sin recetas en biblioteca.</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Checklist de Compromisos Recurrentes</h3></div>
        <div class="list-stack">
          ${
            (draft.sundayPrep?.recurringCommitmentsChecklist || [])
              .map(
                (c) => `
            <div class="list-row">
              <span><strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.frequency)})</span>
              <span class="mono">$${escapeHtml(c.amount)}</span>
            </div>
          `
              )
              .join('') || '<p>Sin compromisos recurrentes registrados.</p>'
          }
        </div>
      </article>
    </div>

    <article class="card">
      <div class="card-head">
        <h3>Vista Previa de los 7 Días</h3>
        <span class="badge badge-accent">Hard conflicts: ${draft.hardConflicts.length}</span>
      </div>
      <div class="week-grid">
        ${draft.dailySchedules
          .map(
            (day) => `
          <div class="day-column">
            <div class="day-header">
              <h3>${escapeHtml(DAY_NAMES[day.dayOfWeek])}</h3>
              <div class="day-nutrition">${day.nutrition?.targetCalories ?? '-'} kcal · Ej: ${day.exerciseCaloriesBurned} kcal</div>
            </div>
            <div class="block-list">
              ${day.blocks
                .map(
                  (b) => `
                <div class="block-item cat-${escapeHtml(b.category)}">
                  <div class="block-meta"><span class="mono">${formatHour(b.startHour)}–${formatHour(b.endHour)}</span><span>${escapeHtml(b.category)}</span></div>
                  <div class="block-title">${escapeHtml(b.title)}</div>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
        `
          )
          .join('')}
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

function renderSaturdaySubMode() {
  const defaultNextSunday = getNextSundayIso();
  const review = state.saturdayReview;
  const exercises = state.catalog?.standardExercises || FALLBACK_EXERCISES;

  return `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>Ritual del Sábado — Preparar Borrador Semanal</h2>
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
            ${exercises
              .map((ex) => {
                const defs = EXERCISE_DEFAULTS[ex.id] || { days: [1, 3, 5], hour: 7 };
                const dur = ex.defaultDurationMinutes ?? 30;
                return `
              <div class="list-row">
                <label class="checkbox-inline">
                  <input type="checkbox" class="sat-ex-check" data-ex-id="${escapeHtml(ex.id)}" ${ex.id === 'ex-walk-brisk' ? 'checked' : ''}>
                  <span><strong>${escapeHtml(ex.name)}</strong> <small style="color:var(--text-secondary);">(${escapeHtml(ex.mets)} METs)</small></span>
                </label>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  <label class="field" style="width:140px;"><span>Días (0=Dom..6=Sáb)</span><input type="text" class="sat-ex-days" data-ex-id="${escapeHtml(ex.id)}" value="${defs.days.join(',')}"></label>
                  <label class="field" style="width:110px;"><span>Hora (decimal)</span><input type="number" class="sat-ex-hour" data-ex-id="${escapeHtml(ex.id)}" step="0.25" min="5" max="22" value="${defs.hour}"></label>
                  <label class="field" style="width:95px;"><span>Minutos</span><input type="number" class="sat-ex-dur" data-ex-id="${escapeHtml(ex.id)}" min="10" max="180" value="${dur}"></label>
                </div>
              </div>
            `;
              })
              .join('')}
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

export async function renderPlanView(contentEl) {
  state.baselines = await apiFetch('/api/planning/baselines');
  const isSat = isTodaySaturday(state.health);

  const subContent = state.planSubMode === 'saturday' ? renderSaturdaySubMode() : await renderActiveWeekSubMode();

  contentEl.innerHTML = `
    <div class="subtabs" role="tablist" aria-label="Modos de Plan Semanal">
      <button type="button" class="subtab ${state.planSubMode === 'active' ? 'active' : ''}" data-plan-submode="active">Semana Activa (Baseline Inmutable)</button>
      <button type="button" class="subtab ${state.planSubMode === 'saturday' ? 'active' : ''}" data-plan-submode="saturday">
        Ritual del Sábado ${isSat || state.saturdayReview ? '<span class="badge badge-warn">Activo</span>' : ''}
      </button>
    </div>
    ${subContent}
  `;
}

export async function handlePlanClick(e, rerender, onAfterApprove) {
  const subBtn = e.target.closest('[data-plan-submode]');
  if (subBtn) {
    state.planSubMode = subBtn.dataset.planSubmode;
    await rerender();
    return true;
  }

  const execSaveBtn = e.target.closest('.exec-save-btn');
  if (execSaveBtn) {
    const blockId = execSaveBtn.dataset.blockId;
    const blockCard = execSaveBtn.closest('.block-item');
    const status = blockCard.querySelector('.exec-status-select')?.value;
    const reason = blockCard.querySelector('.exec-reason-input')?.value?.trim() || null;
    await apiFetch(`/api/planning/baselines/${encodeURIComponent(state.selectedBaselineId)}/executions`, {
      method: 'POST',
      body: JSON.stringify({ blockId, status, reason }),
    });
    showToast(`Ejecución registrada (${status}).`, { type: 'ok' });
    await rerender();
    return true;
  }

  if (e.target.id === 'approve-seal-btn') {
    const review = state.saturdayReview;
    if (!review?.nextWeekDraft) return true;
    const sealed = await apiFetch('/api/planning/saturday/approve', {
      method: 'POST',
      body: JSON.stringify({ draft: review.nextWeekDraft, approvedBy: 'user' }),
    });
    state.selectedBaselineId = sealed.baselineId;
    state.saturdayReview = null;
    state.planSubMode = 'active';
    showToast(`Baseline ${sealed.baselineId} sellada como inmutable.`, { type: 'ok' });
    await onAfterApprove();
    return true;
  }

  return false;
}

export async function handlePlanChange(e, rerender) {
  if (e.target.id === 'baseline-selector') {
    state.selectedBaselineId = e.target.value;
    await rerender();
    return true;
  }
  if (e.target.id === 'approve-confirm-checkbox') {
    const btn = document.getElementById('approve-seal-btn');
    if (btn) btn.disabled = !e.target.checked;
    return true;
  }
  if (e.target.classList.contains('exec-status-select')) {
    const card = e.target.closest('.block-item');
    const reasonInput = card?.querySelector('.exec-reason-input');
    if (reasonInput) {
      const isMissed = e.target.value === 'missed_with_reason';
      reasonInput.classList.toggle('reason-required', isMissed);
      reasonInput.placeholder = isMissed ? 'Motivo obligatorio...' : 'Motivo opcional...';
    }
    return true;
  }
  return false;
}

export async function handlePlanSubmit(form, rerender, onDraftChange) {
  const fd = new FormData(form);
  if (form.id === 'revision-form') {
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
    await rerender();
    return true;
  }

  if (form.id === 'saturday-prepare-form') {
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
    onDraftChange?.();
    showToast('Borrador semanal del sábado generado.', { type: 'ok' });
    await rerender();
    return true;
  }

  return false;
}
