export const CLINICAL_RANGES = Object.freeze({
  fastingGlucose: { min: 70, max: 99, unit: 'mg/dL', label: 'Glucosa en ayunas' },
  totalCholesterol: { min: 0, max: 199, unit: 'mg/dL', label: 'Colesterol total' },
  triglycerides: { min: 0, max: 149, unit: 'mg/dL', label: 'Triglicéridos' },
  ldlCholesterol: { min: 0, max: 99, unit: 'mg/dL', label: 'Colesterol LDL' },
  hdlCholesterol: { min: 40, max: 100, unit: 'mg/dL', label: 'Colesterol HDL' },
  systolicPressure: { min: 90, max: 120, unit: 'mmHg', label: 'Presión sistólica' },
  diastolicPressure: { min: 60, max: 80, unit: 'mmHg', label: 'Presión diastólica' },
});

export function evaluateBiomarker(markerName, value) {
  const range = CLINICAL_RANGES[markerName];
  if (!range) {
    throw new Error(`UNKNOWN_BIOMARKER: El biomarcador ${markerName} no está en la biblioteca clínica.`);
  }
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`INVALID_BIOMARKER_VALUE: Valor inválido para ${markerName}`);
  }

  let status = 'normal';
  if (value < range.min) status = 'low';
  else if (value > range.max) status = 'high';

  return {
    marker: markerName,
    label: range.label,
    value,
    unit: range.unit,
    status,
    isOutOfRange: status !== 'normal',
    referenceRange: { min: range.min, max: range.max },
  };
}

export function evaluateClinicalPanel(panel) {
  if (!panel || typeof panel !== 'object') {
    return { evaluations: [], hasAlerts: false };
  }

  const evaluations = [];
  let hasAlerts = false;

  for (const [key, value] of Object.entries(panel)) {
    if (key === 'recordedAt' || key === 'notes') continue;
    if (CLINICAL_RANGES[key] && value !== undefined && value !== null) {
      const evaluation = evaluateBiomarker(key, value);
      if (evaluation.isOutOfRange) hasAlerts = true;
      evaluations.push(evaluation);
    }
  }

  return {
    recordedAt: panel.recordedAt || new Date().toISOString(),
    evaluations,
    hasAlerts,
  };
}
