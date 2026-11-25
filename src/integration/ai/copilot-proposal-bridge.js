export const ALLOWED_PROPOSAL_TYPES = Object.freeze([
  'log_execution',
  'record_payment',
  'update_weight',
  'add_commitment',
  'propose_goal_adjustment',
]);

export const FORBIDDEN_SENSITIVE_ACTIONS = Object.freeze([
  'execute_bank_transfer',
  'execute_payment',
  'mutate_baseline',
  'delete_baseline',
  'publish_external',
  'delete_all_data',
]);

export function validateAiProposal(rawProposal) {
  if (!rawProposal || typeof rawProposal !== 'object' || Array.isArray(rawProposal)) {
    return { valid: false, reason: 'MALFORMED_PROPOSAL_OBJECT', proposal: null };
  }

  const { type, payload, confidence = null, rationale = null } = rawProposal;

  if (typeof type !== 'string' || !type.trim()) {
    return { valid: false, reason: 'MISSING_PROPOSAL_TYPE', proposal: null };
  }

  if (FORBIDDEN_SENSITIVE_ACTIONS.includes(type)) {
    return {
      valid: false,
      reason: `UNAUTHORIZED_SENSITIVE_ACTION: La IA no puede proponer ni ejecutar "${type}".`,
      proposal: null,
    };
  }

  if (!ALLOWED_PROPOSAL_TYPES.includes(type)) {
    return {
      valid: false,
      reason: `UNSUPPORTED_PROPOSAL_TYPE: Tipo "${type}" fuera de contrato.`,
      proposal: null,
    };
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, reason: 'INVALID_PROPOSAL_PAYLOAD', proposal: null };
  }

  // Validaciones específicas por contrato
  if (type === 'update_weight') {
    if (typeof payload.currentWeightKg !== 'number' || payload.currentWeightKg < 30 || payload.currentWeightKg > 300) {
      return { valid: false, reason: 'INVALID_WEIGHT_PAYLOAD', proposal: null };
    }
  } else if (type === 'record_payment') {
    if (
      typeof payload.commitmentName !== 'string' ||
      !payload.commitmentName.trim() ||
      typeof payload.amount !== 'number' ||
      payload.amount <= 0
    ) {
      return { valid: false, reason: 'INVALID_PAYMENT_PAYLOAD', proposal: null };
    }
  } else if (type === 'log_execution') {
    if (typeof payload.blockId !== 'string' || !payload.blockId.trim() || typeof payload.status !== 'string') {
      return { valid: false, reason: 'INVALID_EXECUTION_PAYLOAD', proposal: null };
    }
  }

  return {
    valid: true,
    reason: null,
    proposal: Object.freeze({
      type,
      payload: structuredClone(payload),
      confidence: typeof confidence === 'number' ? Math.max(0, Math.min(1, confidence)) : null,
      rationale: typeof rationale === 'string' ? rationale : null,
      status: 'pending_human_approval',
      requiresHumanConfirmation: true,
      canAutoExecute: false,
    }),
  };
}

function deterministicFallbackExtract(text) {
  const proposals = [];
  const normalized = String(text || '').trim();

  // Extracción determinista básica de peso (ej. "peso 78.5 kg" o "estoy en 79 kilos")
  const weightMatch = normalized.match(/(?:peso|pesando|estoy en)\s+(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kilos?)/i);
  if (weightMatch) {
    const value = Number(weightMatch[1].replace(',', '.'));
    const validated = validateAiProposal({
      type: 'update_weight',
      payload: { currentWeightKg: value },
      confidence: 1,
      rationale: 'Extracción determinista local sin LLM.',
    });
    if (validated.valid) proposals.push(validated.proposal);
  }

  // Extracción determinista básica de pago (ej. "pagué Netflix 200")
  const paymentMatch = normalized.match(/(?:pagu[eé]|pague)\s+([a-zA-ZÀ-ÿ0-9_\- ]{2,30}?)\s+\$?(\d+(?:[.,]\d{1,2})?)/i);
  if (paymentMatch) {
    const commitmentName = paymentMatch[1].trim();
    const amount = Number(paymentMatch[2].replace(',', '.'));
    const validated = validateAiProposal({
      type: 'record_payment',
      payload: { commitmentName, amount },
      confidence: 1,
      rationale: 'Extracción determinista local sin LLM.',
    });
    if (validated.valid) proposals.push(validated.proposal);
  }

  return proposals;
}

export async function probeOllamaHealth({ endpoint = null, timeoutMs = 2000 } = {}) {
  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    return {
      configured: false,
      available: false,
      mode: 'deterministic_only',
      models: [],
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const parsedUrl = new URL(endpoint);
    const tagsUrl = `${parsedUrl.origin}/api/tags`;
    const response = await fetch(tagsUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        configured: true,
        available: false,
        mode: 'deterministic_fallback',
        endpoint,
        error: `OLLAMA_HTTP_${response.status}`,
        models: [],
      };
    }
    const data = await response.json();
    return {
      configured: true,
      available: true,
      mode: 'ai_ready',
      endpoint,
      models: Array.isArray(data?.models) ? data.models.map((m) => m.name) : [],
    };
  } catch (err) {
    return {
      configured: true,
      available: false,
      mode: 'deterministic_fallback',
      endpoint,
      error: err.message,
      models: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaTransport({
  endpoint = 'http://127.0.0.1:11434/api/generate',
  model = 'qwen2.5:7b',
  timeoutMs = 15000,
} = {}) {
  return async function ollamaTransport({ prompt }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false, format: 'json' }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`OLLAMA_HTTP_${response.status}`);
      }
      const data = await response.json();
      return typeof data.response === 'string' ? JSON.parse(data.response) : data;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function formatDeterministicSaturdayBriefing(briefing) {
  const lines = [];
  lines.push(`# Revisión Semanal — Semana del ${briefing.nextWeekDraft.weekStartDate}`);
  lines.push('Estado: Pendiente de aprobación humana');

  if (briefing.previousWeekSummary) {
    const prev = briefing.previousWeekSummary;
    const pct = Math.round(prev.confirmedCompletionRate * 100);
    lines.push('');
    lines.push('## Cierre de semana anterior');
    lines.push(`- Bloques confirmados: ${prev.confirmedBlocks}/${prev.totalTrackableBlocks} (${pct}% completados).`);
    lines.push(`- Bloques sin confirmar: ${prev.unconfirmedBlocks}.`);
    if (prev.documentedFrictionReasons.length > 0) {
      lines.push(`- Principal fricción registrada: ${prev.documentedFrictionReasons[0].reason} (${prev.documentedFrictionReasons[0].count}x).`);
    }
  }

  if (briefing.pendingQuestions.length > 0) {
    lines.push('');
    lines.push('## Puntos a confirmar antes de sellar la semana');
    briefing.pendingQuestions.forEach((q, idx) => {
      lines.push(`${idx + 1}. [${q.severity}] ${q.question}`);
    });
  }

  const pantry = briefing.nextWeekDraft.sundayPrep?.pantryReport;
  if (pantry) {
    lines.push('');
    lines.push('## Preparación dominical');
    lines.push(`- Costo estimado de despensa: $${pantry.estimatedTotalCost} (Presupuesto: $${pantry.weeklyGroceryBudget}).`);
    lines.push(`- Artículos por comprar: ${pantry.shoppingList.length}.`);
  }

  return lines.join('\n');
}

export function createCopilotProposalBridge({ transport = null } = {}) {
  async function draftProposalsFromText({ text, context = {} }) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return {
        mode: 'deterministic_fallback',
        acceptedProposals: [],
        rejectedProposals: [],
        aiAvailable: false,
      };
    }

    if (typeof transport !== 'function') {
      return {
        mode: 'deterministic_fallback',
        acceptedProposals: deterministicFallbackExtract(text),
        rejectedProposals: [],
        aiAvailable: false,
      };
    }

    try {
      const prompt = JSON.stringify({
        instruction: 'Extrae propuestas estructuradas JSON { proposals: [...] } sin ejecutar cambios.',
        allowedTypes: ALLOWED_PROPOSAL_TYPES,
        context,
        userText: text,
      });

      const rawOutput = await transport({ prompt, text, context });
      const rawList = Array.isArray(rawOutput?.proposals)
        ? rawOutput.proposals
        : (Array.isArray(rawOutput) ? rawOutput : []);

      const acceptedProposals = [];
      const rejectedProposals = [];

      for (const candidate of rawList) {
        const result = validateAiProposal(candidate);
        if (result.valid) {
          acceptedProposals.push(result.proposal);
        } else {
          rejectedProposals.push({ raw: candidate, reason: result.reason });
        }
      }

      return {
        mode: 'ai_validated',
        acceptedProposals,
        rejectedProposals,
        aiAvailable: true,
      };
    } catch (error) {
      return {
        mode: 'deterministic_fallback',
        acceptedProposals: deterministicFallbackExtract(text),
        rejectedProposals: [],
        aiAvailable: false,
        fallbackReason: error.message,
      };
    }
  }

  return {
    draftProposalsFromText,
    formatDeterministicSaturdayBriefing,
  };
}
