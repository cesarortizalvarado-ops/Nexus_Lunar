import { escapeHtml } from './api.js';

const MOOD_COLORS = {
  1: '#ef4444',
  2: '#f97316',
  3: '#f59e0b',
  4: '#84cc16',
  5: '#22c55e',
};

function getHabitCellColor(habits) {
  if (!habits || habits.scheduled === 0) return '#1c2135';
  const known = habits.completed + habits.partial + habits.missed + habits.skipped;
  if (known === 0) return '#252b42'; // UNKNOWN explícito: neutro grisáceo, nunca rojo
  const rate = habits.completionRate ?? 0;
  if (rate >= 0.9) return '#5b3fd6';
  if (rate >= 0.65) return '#7c5cff';
  if (rate >= 0.35) return '#4b3d8f';
  return '#2f2957';
}

export function renderHabitsMoodHeatmap(dailyMatrix = [], { selectedDate = null } = {}) {
  const days = Array.isArray(dailyMatrix) ? dailyMatrix : [];
  if (days.length === 0) {
    return '<div class="empty-state">Sin días en el rango seleccionado para generar el heatmap.</div>';
  }

  const cols = Math.min(10, Math.max(7, Math.ceil(days.length / 3)));
  const cellW = 46;
  const cellH = 42;
  const gap = 6;
  const pad = 8;
  const rows = Math.ceil(days.length / cols);
  const width = pad * 2 + cols * cellW + (cols - 1) * gap;
  const height = pad * 2 + rows * cellH + (rows - 1) * gap + 22;

  const cellsSvg = days
    .map((d, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = pad + col * (cellW + gap);
      const y = pad + row * (cellH + gap);
      const fill = getHabitCellColor(d.habits);
      const isSelected = d.date === selectedDate;
      const hasFailure = (d.habits?.missed ?? 0) > 0 || (d.habits?.skipped ?? 0) > 0;
      const moodColor = d.mood?.mood_score ? MOOD_COLORS[d.mood.mood_score] || '#9b82ff' : '#475569';
      const label = `${d.date}: completados ${d.habits?.completed ?? 0}, fallados ${d.habits?.missed ?? 0}, sin confirmar ${d.habits?.unknown ?? 0}, ánimo ${d.mood?.mood_score ?? 'N/D'}`;

      return `
        <g class="heatmap-cell ${isSelected ? 'selected' : ''}" data-heatmap-date="${escapeHtml(d.date)}" tabindex="0" role="button" aria-label="${escapeHtml(label)}">
          <title>${escapeHtml(label)}</title>
          <rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="7" fill="${fill}" stroke="${isSelected ? '#eceef6' : '#2e3654'}" stroke-width="${isSelected ? '2' : '1'}" />
          <text x="${x + 7}" y="${y + 16}" font-size="11" font-family="ui-monospace, monospace" fill="#eceef6">${escapeHtml(d.date.slice(8, 10))}</text>
          ${hasFailure ? `<circle cx="${x + cellW - 8}" cy="${y + 10}" r="3.5" fill="#ef4444" />` : ''}
          <circle cx="${x + cellW - 9}" cy="${y + cellH - 9}" r="4.5" fill="${moodColor}" />
        </g>
      `;
    })
    .join('');

  const legendY = height - 8;
  return `
    <svg class="svg-heatmap" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mapa de calor de hábitos y estado de ánimo">
      <title>Heatmap diario de hábitos y estado de ánimo</title>
      ${cellsSvg}
      <text x="${pad}" y="${legendY}" font-size="10" fill="#9ca3be">Fondo: cumplimiento hábitos · Gris: UNKNOWN · Punto sup.: fallo · Punto inf.: ánimo (1–5)</text>
    </svg>
  `;
}

export function renderMoodEnergySparkline(dailyMatrix = []) {
  const days = Array.isArray(dailyMatrix) ? dailyMatrix : [];
  const width = 560;
  const height = 160;
  const padL = 30;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const yForScore = (score) => padT + ((5 - score) / 4) * plotH;
  const xForIdx = (idx) => {
    if (days.length <= 1) return padL + plotW / 2;
    return padL + (idx / (days.length - 1)) * plotW;
  };

  const gridLines = [1, 2, 3, 4, 5]
    .map((score) => {
      const y = yForScore(score);
      return `
        <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="#252b42" stroke-dasharray="3 3" />
        <text x="10" y="${y + 4}" font-size="10" font-family="ui-monospace, monospace" fill="#767f9e">${score}</text>
      `;
    })
    .join('');

  const moodPoints = [];
  const energyPoints = [];
  days.forEach((d, idx) => {
    if (!d.mood) return;
    const x = Number(xForIdx(idx).toFixed(1));
    if (typeof d.mood.mood_score === 'number') {
      moodPoints.push({ x, y: Number(yForScore(d.mood.mood_score).toFixed(1)), label: `${d.date}: Ánimo ${d.mood.mood_score}/5` });
    }
    if (typeof d.mood.energy_level === 'number') {
      energyPoints.push({ x, y: Number(yForScore(d.mood.energy_level).toFixed(1)), label: `${d.date}: Energía ${d.mood.energy_level}/5` });
    }
  });

  const moodPolyline = moodPoints.length > 1
    ? `<polyline fill="none" stroke="#9b82ff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" points="${moodPoints.map((p) => `${p.x},${p.y}`).join(' ')}" />`
    : '';
  const energyPolyline = energyPoints.length > 1
    ? `<polyline fill="none" stroke="#22c55e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${energyPoints.map((p) => `${p.x},${p.y}`).join(' ')}" />`
    : '';

  const moodDots = moodPoints
    .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#9b82ff"><title>${escapeHtml(p.label)}</title></circle>`)
    .join('');
  const energyDots = energyPoints
    .map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.2" fill="#22c55e"><title>${escapeHtml(p.label)}</title></circle>`)
    .join('');

  const firstDate = days[0]?.date?.slice(5) || '';
  const midDate = days[Math.floor(days.length / 2)]?.date?.slice(5) || '';
  const lastDate = days[days.length - 1]?.date?.slice(5) || '';

  return `
    <svg class="svg-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="Tendencia de ánimo y energía">
      <title>Tendencia de ánimo (violeta) y energía (esmeralda)</title>
      ${gridLines}
      ${energyPolyline}
      ${moodPolyline}
      ${energyDots}
      ${moodDots}
      ${moodPoints.length === 0 ? `<text x="${padL + 12}" y="${padT + plotH / 2}" font-size="12" fill="#9ca3be">Sin registros emocionales en este rango</text>` : ''}
      <text x="${padL}" y="${height - 6}" font-size="10" font-family="ui-monospace, monospace" fill="#767f9e">${escapeHtml(firstDate)}</text>
      <text x="${padL + plotW / 2 - 14}" y="${height - 6}" font-size="10" font-family="ui-monospace, monospace" fill="#767f9e">${escapeHtml(midDate)}</text>
      <text x="${width - padR - 34}" y="${height - 6}" font-size="10" font-family="ui-monospace, monospace" fill="#767f9e">${escapeHtml(lastDate)}</text>
    </svg>
  `;
}

export function renderProgressBarSvg(ratio, label = null) {
  const width = 260;
  const height = 22;
  const hasRatio = typeof ratio === 'number' && Number.isFinite(ratio);
  const clamped = hasRatio ? Math.max(0, Math.min(1, ratio)) : 0;
  const pct = hasRatio ? Math.round(clamped * 100) : null;
  const fillWidth = Math.round(clamped * width);
  const barColor = !hasRatio ? '#252b42' : pct >= 100 ? '#22c55e' : '#7c5cff';
  const displayLabel = label ?? (hasRatio ? `${pct}%` : 'Sin tareas');

  return `
    <svg class="svg-progress" viewBox="0 0 ${width} ${height}" role="img" aria-label="Progreso ${escapeHtml(displayLabel)}">
      <title>${escapeHtml(displayLabel)}</title>
      <rect x="0" y="3" width="${width}" height="16" rx="8" fill="#10131e" stroke="#282e45" />
      ${hasRatio && fillWidth > 0 ? `<rect x="0" y="3" width="${fillWidth}" height="16" rx="8" fill="${barColor}" />` : ''}
      <text x="${width - 8}" y="14.5" text-anchor="end" font-size="10" font-family="ui-monospace, monospace" fill="#eceef6">${escapeHtml(displayLabel)}</text>
    </svg>
  `;
}
