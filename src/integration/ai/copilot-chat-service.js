import { addDays } from '../../shared/clock.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

const SATURDAY_PLAN_INTENT_RE = /\b(plan\s+semanal|planear\s+la\s+semana|revisi[oó]n\s+del\s+s[aá]bado|borrador\s+semanal|organizar\s+mi\s+semana)\b/i;

function buildDeterministicReply({
  message,
  snapshot,
  unpaidCommitments,
  projectsGoals,
  habitsMood,
  calendar,
  acceptedProposals,
  saturdayReview,
}) {
  const parts = [];
  const lower = message.toLowerCase();

  if (saturdayReview) {
    parts.push(
      'Generé un borrador determinista para la revisión semanal. **Requiere tu aprobación humana explícita** antes de sellarse como baseline inmutable.'
    );
    if (saturdayReview.briefingMarkdown) {
      parts.push(saturdayReview.briefingMarkdown);
    }
  }

  if (acceptedProposals.length > 0) {
    const summaryList = acceptedProposals.map((p) => `- \`${p.type}\`: ${JSON.stringify(p.payload)}`).join('\n');
    parts.push(
      `Detecté ${acceptedProposals.length} propuesta(s) estructurada(s) pendientes de tu confirmación humana (no se ha modificado SQLite automáticamente):\n${summaryList}`
    );
  }

  const asksFinance = /\b(finanz|dinero|saldo|cuenta|pago|pagos|suscrip|gasto|ingreso|presupuesto)\b/i.test(lower);
  const asksProjects = /\b(proyecto|proyectos|meta|metas|tarea|tareas|avance|pendiente|factib)\b/i.test(lower);
  const asksHabitsMood = /\b(h[aá]bito|habito|emoci|ánimo|animo|racha|fallo|estr[eé]s|energ[ií]a)\b/i.test(lower);
  const asksCalendar = /\b(calendario|cumplea[nñ]o|fecha|evento|agenda|mes|aniversario)\b/i.test(lower);
  const asksWeek = /\b(semana\s+actual|baseline|plan\s+activo)\b/i.test(lower);

  if (asksFinance) {
    const currencies = Object.values(projectsGoals.financeSummary?.currencies || {});
    const balText =
      currencies.length > 0
        ? currencies
            .map(
              (c) =>
                `${c.currency}: saldo calculado $${c.calculated_balance}, disponible $${c.available_money} (ingresos $${c.total_income} / gastos $${c.total_expense})`
            )
            .join('; ')
        : 'Sin cuentas financieras registradas en Finanzas.';
    const unpaidText =
      unpaidCommitments.length > 0
        ? `Pagos recurrentes pendientes (${unpaidCommitments.length}): ${unpaidCommitments.map((u) => `${u.commitmentName} ($${u.expectedAmount})`).join(', ')}.`
        : 'Sin pagos recurrentes vencidos pendientes en el periodo actual.';
    parts.push(`**Finanzas y Compromisos:** ${balText} ${unpaidText}`);
  }

  if (asksProjects) {
    const s = projectsGoals.summary;
    const projLines = projectsGoals.projects
      .slice(0, 5)
      .map(
        (p) =>
          `- ${p.name}: ${p.completed_tasks}/${p.total_active_tasks} tareas (${p.task_completion_ratio !== null ? Math.round(p.task_completion_ratio * 100) : 0}%)`
      )
      .join('\n');
    const feasNote = projectsGoals.feasibility
      ? (projectsGoals.feasibility.feasible
          ? 'Factibilidad de metas: sin colisiones.'
          : `Conflictos de factibilidad detectados: ${projectsGoals.feasibility.conflicts.length}.`)
      : '';
    parts.push(
      `**Proyectos y Metas:** ${s.activeGoals} metas activas, ${s.activeProjects} proyectos activos, ${s.pendingTasks} tareas pendientes, ${s.completedTasks} completadas. ${feasNote}${projLines ? `\n${projLines}` : ''}`
    );
  }

  if (asksHabitsMood) {
    const ms = habitsMood.moodSummary;
    const avgText = ms.entriesCount > 0
      ? `Promedio emocional (7d): ánimo ${ms.averageMood}/5, energía ${ms.averageEnergy}/5, estrés ${ms.averageStress}/5 (${ms.entriesCount} registros).`
      : 'Sin registros emocionales en los últimos 7 días.';
    const habText = habitsMood.habitsSummary.length > 0
      ? habitsMood.habitsSummary
          .slice(0, 5)
          .map(
            (h) =>
              `- ${h.name}: racha actual ${h.currentStreak}d, mejor ${h.bestStreak}d, fallos recientes ${h.recentFailures.length}`
          )
          .join('\n')
      : 'Sin hábitos activos registrados.';
    parts.push(`**Hábitos y Bienestar:** ${avgText}\n${habText}`);
  }

  if (asksCalendar) {
    const impDates = calendar.items.filter((i) => i.type === 'important_date');
    const events = calendar.items.filter((i) => i.type === 'calendar_event');
    const impText =
      impDates.length > 0
        ? impDates
            .map(
              (d) =>
                `${d.date}: ${d.title}${d.metadata?.turnsAge !== undefined ? ` (${d.metadata.turnsAge} años)` : ''}`
            )
            .join('; ')
        : 'Sin fechas importantes este mes.';
    const evText =
      events.length > 0
        ? events.map((e) => `${e.date} ${e.metadata?.startTime ?? ''}: ${e.title}`).join('; ')
        : 'Sin eventos de calendario este mes.';
    parts.push(`**Calendario Maestro (${calendar.year}-${String(calendar.month).padStart(2, '0')}):** Fechas importantes: ${impText} Eventos: ${evText}`);
  }

  if (asksWeek) {
    const latestBaseline = Object.values(snapshot.baselines || {})
      .sort((a, b) => String(b.plan?.weekStartDate || '').localeCompare(String(a.plan?.weekStartDate || '')))[0];
    if (latestBaseline) {
      parts.push(
        `**Semana Activa:** Baseline \`${latestBaseline.baselineId}\` (inicio ${latestBaseline.plan?.weekStartDate}, hash \`${String(latestBaseline.integrityHash || '').slice(0, 12)}...\`).`
      );
    } else {
      parts.push('**Semana Activa:** No hay ninguna baseline semanal sellada todavía.');
    }
  }

  if (parts.length === 0) {
    const s = projectsGoals.summary;
    const profileMsg = snapshot.profile
      ? `Perfil activo (${snapshot.profile.biometrics.currentWeightKg} kg).`
      : 'Perfil personal aún sin inicializar en Espacios.';
    parts.push(
      `Pulso local: ${profileMsg} ${s.pendingTasks} tareas pendientes, ${unpaidCommitments.length} pago(s) pendiente(s), ${calendar.totalItems} elementos en el calendario del mes. Puedes consultar finanzas, proyectos/metas, hábitos/emociones, calendario o pedir "planear la semana".`
    );
  }

  return parts.join('\n\n');
}

async function tryOllamaReply({ endpoint, model, message, recentMessages, contextSummary }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'qwen2.5:7b',
        stream: false,
        format: 'json',
        prompt: JSON.stringify({
          instruction: 'Responde en español de forma breve, precisa y sin inventar datos. Devuelve JSON {"reply": "..."}.',
          contextSummary,
          recentMessages: recentMessages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          userMessage: message,
        }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const parsed = typeof data?.response === 'string' ? JSON.parse(data.response) : data;
    if (typeof parsed?.reply === 'string' && parsed.reply.trim()) {
      return parsed.reply.trim();
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function createCopilotChatService({
  aiConversationService,
  copilotBridge,
  dashboardAggregatorService,
  specializedSpacesService,
  prepareSaturdayReviewFn = null,
  clock,
  ollamaConfig = null,
}) {
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));

  return {
    listConversations(filters = {}) {
      return aiConversationService.listConversations(filters);
    },

    getConversationMessages(conversationId) {
      return aiConversationService.getConversationMessages(conversationId);
    },

    async sendMessage({
      conversationId = null,
      message,
      referenceDate = null,
      weeklyGroceryBudget = 1200,
      exerciseScheduleRequests = [],
    } = {}) {
      if (typeof message !== 'string' || !message.trim()) {
        throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'message es obligatorio en copilot.chat.send.', {
          field: 'message',
        });
      }

      const refDate = referenceDate || todayDate();
      const conv = conversationId
        ? aiConversationService.getConversation(conversationId)
        : aiConversationService.createConversation({ conversation_type: 'COPILOT_PERSISTENT' });

      const userMessage = aiConversationService.appendMessage(conv.id, {
        role: 'USER',
        content: message,
        metadata: { referenceDate: refDate },
      });

      const snapshot = specializedSpacesService.getSnapshot();
      const unpaidCommitments = specializedSpacesService.detectUnpaidCommitments(refDate);
      const projectsGoals = dashboardAggregatorService.getProjectsAndGoalsDashboard({
        referenceDate: refDate,
      });
      const habitsMood = dashboardAggregatorService.getHabitsAndMoodDashboard({
        from: addDays(refDate, -6),
        to: refDate,
      });
      const [refYear, refMonth] = refDate.split('-').map(Number);
      const calendar = dashboardAggregatorService.getMasterCalendar({
        year: refYear,
        month: refMonth,
      });

      const compactContext = {
        referenceDate: refDate,
        hasProfile: Boolean(snapshot.profile),
        currentWeightKg: snapshot.profile?.biometrics?.currentWeightKg ?? null,
        unpaidCommitmentsCount: unpaidCommitments.length,
        projectsGoalsSummary: projectsGoals.summary,
        financeSummary: projectsGoals.financeSummary,
        moodSummary: habitsMood.moodSummary,
        calendarTotalItems: calendar.totalItems,
      };

      // Paso A — Propuestas estructuradas seguras (nunca auto-ejecuta)
      const proposalDraft = await copilotBridge.draftProposalsFromText({
        text: message,
        context: compactContext,
      });
      const acceptedProposals = proposalDraft.acceptedProposals ?? [];
      const rejectedProposals = proposalDraft.rejectedProposals ?? [];

      // Paso B — Detección de intención de Planificación Semanal / Sábado (nunca sella automáticamente)
      let saturdayReview = null;
      if (SATURDAY_PLAN_INTENT_RE.test(message) && snapshot.profile && typeof prepareSaturdayReviewFn === 'function') {
        saturdayReview = prepareSaturdayReviewFn({
          referenceDate: refDate,
          weeklyGroceryBudget,
          exerciseScheduleRequests,
        });
      }

      // Paso C — Respuesta determinista fundamentada + enriquecimiento opcional con Ollama
      const deterministicReply = buildDeterministicReply({
        message,
        snapshot,
        unpaidCommitments,
        projectsGoals,
        habitsMood,
        calendar,
        acceptedProposals,
        saturdayReview,
      });

      let finalReply = deterministicReply;
      let mode = 'deterministic_local';
      let aiAvailable = false;

      if (ollamaConfig?.endpoint) {
        const recentMessages = aiConversationService.getConversationMessages(conv.id);
        const ollamaReply = await tryOllamaReply({
          endpoint: ollamaConfig.endpoint,
          model: ollamaConfig.model,
          message,
          recentMessages,
          contextSummary: compactContext,
        });
        if (ollamaReply) {
          finalReply = ollamaReply;
          mode = 'ai_assisted';
          aiAvailable = true;
        }
      }

      const assistantMessage = aiConversationService.appendMessage(conv.id, {
        role: 'ASSISTANT',
        content: finalReply,
        metadata: {
          mode,
          aiAvailable,
          acceptedProposals,
          rejectedProposals,
          hasSaturdayReview: Boolean(saturdayReview),
        },
      });

      return {
        conversationId: conv.id,
        mode,
        aiAvailable,
        userMessage,
        assistantMessage,
        acceptedProposals,
        rejectedProposals,
        saturdayReview,
      };
    },
  };
}
