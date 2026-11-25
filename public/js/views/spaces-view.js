import { apiFetch, escapeHtml, FALLBACK_CLINICAL_RANGES, showToast, todayLocalIso } from '../api.js';
import { state } from '../state.js';

function getClinicalRanges() {
  return state.catalog?.clinicalRanges || FALLBACK_CLINICAL_RANGES;
}

function renderLatestClinicalSummary(panel, ranges) {
  if (!panel) return '<small>Registra un panel clínico para evaluar triglicéridos, glucosa y colesterol.</small>';
  const badges = [];
  for (const [k, def] of Object.entries(ranges)) {
    if (typeof panel[k] !== 'number') continue;
    const out = panel[k] < def.min || panel[k] > def.max;
    badges.push(`<span class="badge ${out ? 'badge-err' : 'badge-normal'}">${escapeHtml(def.label)}: ${panel[k]} ${escapeHtml(def.unit)}</span>`);
  }
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;">${badges.join('')}</div>`;
}

function renderEmploymentsEditor(employments) {
  return employments
    .map((emp, idx) => {
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
            ${
              emp.type === 'fixed'
                ? `
              <label class="field"><span>Ingreso ($)</span><input type="number" class="emp-amount" min="0" value="${escapeHtml(incomeAmount)}"></label>
              <label class="field"><span>Frecuencia</span>
                <select class="emp-freq">
                  <option value="weekly" ${incomeFreq === 'weekly' ? 'selected' : ''}>weekly</option>
                  <option value="biweekly" ${incomeFreq === 'biweekly' ? 'selected' : ''}>biweekly</option>
                  <option value="monthly" ${incomeFreq === 'monthly' ? 'selected' : ''}>monthly</option>
                </select>
              </label>
              <label class="field"><span>Ventanas (día:ini-fin)</span><input type="text" class="emp-windows" value="${escapeHtml(winText)}" placeholder="1:8-15, 1:16-18"></label>
            `
                : `
              <label class="field"><span>Meta horas/sem</span><input type="number" class="emp-target-hours" min="0" max="168" value="${escapeHtml(emp.targetWeeklyHours ?? 0)}"></label>
              <label class="field"><span>Ingresos históricos ($)</span><input type="text" class="emp-hist-incomes" value="${escapeHtml(histAvg)}" placeholder="2000, 3000"></label>
            `
            }
          </div>
          ${employments.length > 1 ? `<button type="button" class="btn btn-danger btn-sm remove-emp-btn" data-emp-index="${idx}" style="margin-top:8px;">Eliminar</button>` : ''}
        </div>
      `;
    })
    .join('');
}

function renderCommitmentsEditor(commitments) {
  return (
    commitments
      .map(
        (c, idx) => `
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
    `
      )
      .join('') || '<small>Sin compromisos registrados. Usa "+ Añadir Compromiso".</small>'
  );
}

function renderWellbeingAndDatesCard() {
  const refDate = todayLocalIso(state.health?.timezone);
  const todayMood = state.moods.find((m) => m.entry_date === refDate) || state.moods[state.moods.length - 1] || null;
  return `
    <div class="grid-2">
      <article class="card">
        <div class="card-head">
          <div>
            <h3>Estado Emocional Diario</h3>
            <small>Registro único por día (upsert) con detonantes y energía</small>
          </div>
          ${todayMood ? `<span class="badge badge-accent">${escapeHtml(todayMood.entry_date)}: ${todayMood.mood_score}/5</span>` : ''}
        </div>
        <form id="wellbeing-mood-form">
          <div class="field-row">
            <label class="field"><span>Fecha</span><input type="date" name="entry_date" value="${escapeHtml(refDate)}" required></label>
            <label class="field"><span>Ánimo (1-5)</span><input type="number" name="mood_score" min="1" max="5" value="${escapeHtml(todayMood?.mood_score ?? 4)}" required></label>
            <label class="field"><span>Energía (1-5)</span><input type="number" name="energy_level" min="1" max="5" value="${escapeHtml(todayMood?.energy_level ?? 4)}" required></label>
            <label class="field"><span>Estrés (1-5)</span><input type="number" name="stress_level" min="1" max="5" value="${escapeHtml(todayMood?.stress_level ?? 2)}" required></label>
          </div>
          <div class="field-row" style="margin-top:10px;">
            <label class="field"><span>Detonantes (separados por coma)</span><input type="text" name="triggers" value="${escapeHtml((todayMood?.triggers || []).join(', '))}" placeholder="sueño, ejercicio, trabajo"></label>
            <label class="field"><span>Notas</span><input type="text" name="notes" value="${escapeHtml(todayMood?.notes ?? '')}" placeholder="Observación breve..."></label>
          </div>
          <div style="margin-top:12px;">
            <button type="submit" class="btn btn-primary btn-sm">Guardar Estado Emocional</button>
          </div>
        </form>
      </article>

      <article class="card">
        <div class="card-head">
          <div>
            <h3>Fechas Importantes (${state.importantDates.length})</h3>
            <small>Cumpleaños, aniversarios, renovaciones y fechas clave</small>
          </div>
        </div>
        <form id="important-date-form" style="margin-bottom:12px;">
          <div class="field-row">
            <label class="field"><span>Título</span><input type="text" name="title" required placeholder="Cumpleaños de Ana"></label>
            <label class="field"><span>Categoría</span>
              <select name="category">
                <option value="birthday">birthday</option>
                <option value="anniversary">anniversary</option>
                <option value="renewal">renewal</option>
                <option value="deadline">deadline</option>
                <option value="custom">custom</option>
              </select>
            </label>
            <label class="field"><span>Mes (1-12)</span><input type="number" name="month" min="1" max="12" required value="11"></label>
            <label class="field"><span>Día (1-31)</span><input type="number" name="day" min="1" max="31" required value="15"></label>
            <label class="field"><span>Año opc.</span><input type="number" name="year" min="1900" max="2200" placeholder="1995"></label>
          </div>
          <div style="margin-top:10px;">
            <button type="submit" class="btn btn-primary btn-sm">Agregar Fecha Importante</button>
          </div>
        </form>
        <div class="list-stack">
          ${state.importantDates.map((d) => `
            <div class="list-row">
              <span><strong class="mono">${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}${d.year ? `/${d.year}` : ''}</strong> · ${escapeHtml(d.title)} <span class="badge">${escapeHtml(d.category)}</span></span>
              <button type="button" class="btn btn-danger btn-sm archive-important-date-btn" data-id="${escapeHtml(d.id)}">Archivar</button>
            </div>
          `).join('') || '<small>Sin fechas importantes registradas.</small>'}
        </div>
      </article>
    </div>
  `;
}

export async function renderSpacesView(contentEl) {
  const [snap, accounts, dates, moods] = await Promise.all([
    apiFetch('/api/spaces/snapshot'),
    apiFetch('/api/finance/accounts'),
    apiFetch('/api/wellbeing/important-dates'),
    apiFetch('/api/wellbeing/moods'),
  ]);
  state.snapshot = snap;
  state.financeAccounts = accounts || [];
  state.importantDates = dates || [];
  state.moods = moods || [];

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
      ${renderWellbeingAndDatesCard()}
    `;
    return;
  }

  const profile = snap.profile;
  state.draftEmployments = structuredClone(profile.employments || (profile.employment ? [profile.employment] : []));
  state.draftCommitments = structuredClone(profile.recurringCommitments || []);

  const ranges = getClinicalRanges();
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
            ${Object.entries(ranges).map(([key, def]) => `
              <label class="field">
                <span>${escapeHtml(def.label)} (${escapeHtml(def.unit)})</span>
                <input type="number" name="${escapeHtml(key)}" min="0" step="0.1" value="${latestLab?.[key] !== undefined ? escapeHtml(latestLab[key]) : ''}">
              </label>
            `).join('')}
          </div>
          <div style="margin-top:12px;">
            <button type="submit" class="btn btn-secondary">Registrar Panel Clínico</button>
          </div>
        </form>
        <div id="clinical-evaluation-box" style="margin-top:12px;">
          ${renderLatestClinicalSummary(latestLab, ranges)}
        </div>
      </article>
    </div>

    ${renderWellbeingAndDatesCard()}

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
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <select id="payment-account-select" style="width:auto;min-width:210px;" aria-label="Cuenta financiera para vincular pagos">
            <option value="">Registrar sin vincular cuenta</option>
            ${state.financeAccounts.map((a) => `<option value="${escapeHtml(a.id)}">Vincular a: ${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`).join('')}
          </select>
          <button type="button" class="btn btn-secondary btn-sm" id="add-commitment-btn">+ Añadir Compromiso</button>
          <button type="button" class="btn btn-primary btn-sm" id="save-commitments-btn">Guardar Compromisos</button>
        </div>
      </div>

      ${
        (snap.unpaidCommitments || []).length > 0
          ? `
        <div class="list-stack" style="margin-bottom:12px;">
          ${snap.unpaidCommitments
            .map(
              (u) => `
            <div class="alert-banner warn">
              <span><strong>Pago pendiente:</strong> ${escapeHtml(u.commitmentName)} ($${escapeHtml(u.expectedAmount)}) — periodo ${escapeHtml(u.periodKey)}</span>
              <button type="button" class="btn btn-primary btn-sm mark-paid-btn" data-name="${escapeHtml(u.commitmentName)}" data-amount="${escapeHtml(u.expectedAmount)}">Marcar Pagado</button>
            </div>
          `
            )
            .join('')}
        </div>
      `
          : '<div class="alert-banner ok" style="margin-bottom:12px;"><span>Sin pagos recurrentes vencidos pendientes para el periodo actual.</span></div>'
      }

      <div class="list-stack" id="commitments-editor">
        ${renderCommitmentsEditor(state.draftCommitments)}
      </div>
    </article>
  `;
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

export async function handleSpacesClick(e, rerender) {
  if (e.target.id === 'add-employment-btn') {
    state.draftEmployments.push({ type: 'freelance', title: 'Nueva fuente', targetWeeklyHours: 5, historicalIncomes: [] });
    document.getElementById('employments-editor').innerHTML = renderEmploymentsEditor(state.draftEmployments);
    return true;
  }

  const removeEmpBtn = e.target.closest('.remove-emp-btn');
  if (removeEmpBtn) {
    const idx = Number(removeEmpBtn.dataset.empIndex);
    state.draftEmployments.splice(idx, 1);
    document.getElementById('employments-editor').innerHTML = renderEmploymentsEditor(state.draftEmployments);
    return true;
  }

  if (e.target.id === 'save-employments-btn') {
    const employments = collectEmploymentsFromDom();
    await apiFetch('/api/spaces/employments', {
      method: 'PUT',
      body: JSON.stringify({ employments }),
    });
    showToast('Empleos guardados correctamente.', { type: 'ok' });
    await rerender();
    return true;
  }

  if (e.target.id === 'add-commitment-btn') {
    state.draftCommitments.push({ name: 'Nuevo servicio', amount: 200, frequency: 'monthly' });
    document.getElementById('commitments-editor').innerHTML = renderCommitmentsEditor(state.draftCommitments);
    return true;
  }

  const removeCommBtn = e.target.closest('.remove-comm-btn');
  if (removeCommBtn) {
    const idx = Number(removeCommBtn.dataset.commIndex);
    state.draftCommitments.splice(idx, 1);
    document.getElementById('commitments-editor').innerHTML = renderCommitmentsEditor(state.draftCommitments);
    return true;
  }

  if (e.target.id === 'save-commitments-btn') {
    const recurringCommitments = collectCommitmentsFromDom();
    await apiFetch('/api/spaces/commitments', {
      method: 'PUT',
      body: JSON.stringify({ recurringCommitments }),
    });
    showToast('Compromisos recurrentes guardados.', { type: 'ok' });
    await rerender();
    return true;
  }

  const markPaidBtn = e.target.closest('.mark-paid-btn');
  if (markPaidBtn) {
    const accountId = document.getElementById('payment-account-select')?.value || null;
    await apiFetch('/api/spaces/commitments/payments', {
      method: 'POST',
      body: JSON.stringify({
        commitmentName: markPaidBtn.dataset.name,
        amount: Number(markPaidBtn.dataset.amount),
        ...(accountId ? { account_id: accountId } : {}),
      }),
    });
    showToast(`Pago registrado para ${markPaidBtn.dataset.name}.`, { type: 'ok' });
    await rerender();
    return true;
  }

  const archiveDateBtn = e.target.closest('.archive-important-date-btn');
  if (archiveDateBtn) {
    await apiFetch(`/api/wellbeing/important-dates/${encodeURIComponent(archiveDateBtn.dataset.id)}`, {
      method: 'DELETE',
    });
    showToast('Fecha importante archivada.', { type: 'ok' });
    await rerender();
    return true;
  }

  return false;
}

export function handleSpacesChange(e) {
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
    return true;
  }
  return false;
}

export async function handleSpacesSubmit(form, rerender) {
  const fd = new FormData(form);
  if (form.id === 'init-profile-form') {
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
          recurringCommitments: [{ name: fd.get('commName'), amount: Number(fd.get('commAmount')), frequency: 'monthly' }],
          preferences: { dislikedIngredients: [] },
        },
      }),
    });
    showToast('Perfil personal inicializado.', { type: 'ok' });
    await rerender();
    return true;
  }

  if (form.id === 'quick-weight-form') {
    await apiFetch('/api/spaces/biometrics', {
      method: 'PATCH',
      body: JSON.stringify({ currentWeightKg: Number(fd.get('currentWeightKg')) }),
    });
    showToast('Peso biométrico actualizado.', { type: 'ok' });
    await rerender();
    return true;
  }

  if (form.id === 'clinical-panel-form') {
    const panel = {};
    const ranges = getClinicalRanges();
    for (const key of Object.keys(ranges)) {
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
      res.evaluation?.hasAlerts ? 'Panel registrado con biomarcadores fuera de rango.' : 'Panel clínico registrado dentro de rangos normales.',
      { type: res.evaluation?.hasAlerts ? 'info' : 'ok' }
    );
    await rerender();
    return true;
  }

  if (form.id === 'wellbeing-mood-form') {
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
        triggers,
        notes: fd.get('notes') || '',
      }),
    });
    showToast('Estado emocional guardado.', { type: 'ok' });
    await rerender();
    return true;
  }

  if (form.id === 'important-date-form') {
    const rawYear = fd.get('year');
    await apiFetch('/api/wellbeing/important-dates', {
      method: 'POST',
      body: JSON.stringify({
        title: fd.get('title'),
        category: fd.get('category'),
        month: Number(fd.get('month')),
        day: Number(fd.get('day')),
        ...(rawYear !== null && String(rawYear).trim() !== '' ? { year: Number(rawYear) } : {}),
        recurrence: 'ANNUAL',
      }),
    });
    showToast('Fecha importante agregada.', { type: 'ok' });
    await rerender();
    return true;
  }

  return false;
}
