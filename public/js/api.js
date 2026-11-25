export const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export const EXECUTION_STATUSES = [
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

export const FALLBACK_CLINICAL_RANGES = {
  fastingGlucose: { min: 70, max: 99, unit: 'mg/dL', label: 'Glucosa en ayunas' },
  totalCholesterol: { min: 0, max: 199, unit: 'mg/dL', label: 'Colesterol total' },
  triglycerides: { min: 0, max: 149, unit: 'mg/dL', label: 'Triglicéridos' },
  ldlCholesterol: { min: 0, max: 99, unit: 'mg/dL', label: 'Colesterol LDL' },
  hdlCholesterol: { min: 40, max: 100, unit: 'mg/dL', label: 'Colesterol HDL' },
  systolicPressure: { min: 90, max: 120, unit: 'mmHg', label: 'Presión sistólica' },
  diastolicPressure: { min: 60, max: 80, unit: 'mmHg', label: 'Presión diastólica' },
};

export const FALLBACK_EXERCISES = [
  { id: 'ex-walk-brisk', name: 'Caminata rápida (dog walk / paseo)', category: 'cardio', mets: 3.8, defaultDurationMinutes: 30 },
  { id: 'ex-weightlifting-moderate', name: 'Entrenamiento con pesas (intensidad media/alta)', category: 'strength', mets: 5.0, defaultDurationMinutes: 40 },
  { id: 'ex-stationary-bike', name: 'Bicicleta estática (ritmo moderado)', category: 'cardio', mets: 6.8, defaultDurationMinutes: 30 },
  { id: 'ex-mobility-stretch', name: 'Movilidad articular y estiramiento', category: 'mobility', mets: 2.5, defaultDurationMinutes: 20 },
];

export function escapeHtml(val) {
  return String(val ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatHour(decimalHour) {
  const h = Math.floor(Number(decimalHour));
  const m = Math.round((Number(decimalHour) - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function todayLocalIso(timeZone = null) {
  const d = new Date();
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d);
      const get = (t) => parts.find((p) => p.type === t)?.value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      // Fallback local
    }
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getNextSundayIso() {
  const now = new Date();
  const day = now.getDay();
  const offset = day === 0 ? 7 : 7 - day;
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isTodaySaturday(health = null) {
  const tz = health?.timezone || null;
  if (tz) {
    try {
      const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date());
      return weekday === 'Sat';
    } catch {
      // Fallback local
    }
  }
  return new Date().getDay() === 6;
}

export function showToast(message, { type = 'info', remediation = null } = {}) {
  const toastContainerEl = document.getElementById('toast-container');
  if (!toastContainerEl) return;
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

export async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errObj = body?.error ?? body?.errors?.[0] ?? {};
    const err = new Error(errObj.description ?? `Error HTTP ${res.status}`);
    err.remediation = errObj.remediation ?? null;
    err.code = errObj.code ?? null;
    throw err;
  }
  return body.data !== undefined ? body.data : body;
}
