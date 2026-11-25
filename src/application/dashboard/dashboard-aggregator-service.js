import {
  addDays,
  dayOfWeekUtc,
  formatDateInTimeZone,
  formatTimeInTimeZone,
} from '../../shared/clock.js';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';
import { evaluateGoalFeasibility } from '../personal/goal-feasibility-evaluator.js';

function round2(value) {
  return Number(Number(value).toFixed(2));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function computeIsoWeekKey(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${isoYear}-W${pad2(weekNo)}`;
}

function computeStreaks(occurrences) {
  let bestStreak = 0;
  let running = 0;
  for (const o of occurrences) {
    if (o.status === 'COMPLETED') {
      running += 1;
      if (running > bestStreak) bestStreak = running;
    } else if (o.status !== 'UNKNOWN') {
      running = 0;
    } else {
      running = 0;
    }
  }

  let currentStreak = 0;
  let idx = occurrences.length - 1;
  while (idx >= 0 && occurrences[idx].status === 'UNKNOWN') {
    idx -= 1;
  }
  while (idx >= 0 && occurrences[idx].status === 'COMPLETED') {
    currentStreak += 1;
    idx -= 1;
  }

  return { currentStreak, bestStreak };
}

export function createDashboardAggregatorService({
  habitService,
  wellbeingService,
  goalService,
  projectService,
  taskService,
  financialTransactionService,
  financialCommitmentService,
  calendarService,
  commitmentService,
  specializedSpacesService,
  clock,
}) {
  const todayDate = () => (clock ? clock.todayDate() : new Date().toISOString().slice(0, 10));
  const timezone = () => clock?.timezone ?? 'UTC';

  function getHabitsAndMoodDashboard({ from = null, to = null } = {}) {
    const resolvedTo = to || todayDate();
    const resolvedFrom = from || addDays(resolvedTo, -29);
    if (resolvedFrom > resolvedTo) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'from no puede ser posterior a to.', {
        field: 'from',
      });
    }

    const activeHabits = habitService.listHabits({ status: 'ACTIVE' }) || [];
    const moodEntries = wellbeingService.listMoodEntries({ from: resolvedFrom, to: resolvedTo }) || [];
    const moodByDate = new Map(moodEntries.map((m) => [m.entry_date, m]));

    const dayBuckets = new Map();
    let cursor = resolvedFrom;
    while (cursor <= resolvedTo) {
      const m = moodByDate.get(cursor) ?? null;
      dayBuckets.set(cursor, {
        date: cursor,
        dayOfWeek: dayOfWeekUtc(cursor),
        mood: m
          ? {
              mood_score: m.mood_score,
              energy_level: m.energy_level,
              stress_level: m.stress_level,
              mood_label: m.mood_label,
              triggers: m.triggers ?? [],
              notes: m.notes ?? '',
            }
          : null,
        habits: {
          scheduled: 0,
          completed: 0,
          partial: 0,
          missed: 0,
          skipped: 0,
          unknown: 0,
          completionRate: null,
        },
        failures: [],
      });
      cursor = addDays(cursor, 1);
    }

    const habitsSummary = [];
    for (const habit of activeHabits) {
      const occs = habitService.getHabitOccurrences(habit.id, {
        from: resolvedFrom,
        to: resolvedTo,
        fillUnknown: true,
      }) || [];
      const stats = habitService.calculateHabitStatistics(habit.id, {
        from: resolvedFrom,
        to: resolvedTo,
      });
      const { currentStreak, bestStreak } = computeStreaks(occs);
      const recentFailures = [];

      for (const occ of occs) {
        const bucket = dayBuckets.get(occ.scheduled_date);
        if (bucket) {
          bucket.habits.scheduled += 1;
          if (occ.status === 'COMPLETED') bucket.habits.completed += 1;
          else if (occ.status === 'PARTIAL') bucket.habits.partial += 1;
          else if (occ.status === 'MISSED') bucket.habits.missed += 1;
          else if (occ.status === 'SKIPPED') bucket.habits.skipped += 1;
          else bucket.habits.unknown += 1;

          if (occ.status === 'MISSED' || occ.status === 'SKIPPED') {
            bucket.failures.push({
              habitId: habit.id,
              habitName: habit.name,
              status: occ.status,
              notes: occ.notes ?? '',
            });
          }
        }

        if (occ.status === 'MISSED' || occ.status === 'SKIPPED') {
          recentFailures.push({
            date: occ.scheduled_date,
            status: occ.status,
            notes: occ.notes ?? '',
          });
        }
      }

      habitsSummary.push({
        id: habit.id,
        name: habit.name,
        category: habit.category,
        status: habit.status,
        currentStreak,
        bestStreak,
        counts: stats.counts,
        completionRateOfKnown: stats.completion_rate_of_known,
        recentFailures: recentFailures.slice(-5).reverse(),
      });
    }

    const dailyMatrix = [...dayBuckets.values()].map((day) => {
      const known =
        day.habits.completed + day.habits.partial + day.habits.missed + day.habits.skipped;
      day.habits.completionRate =
        known > 0 ? Number(((day.habits.completed + day.habits.partial * 0.5) / known).toFixed(4)) : null;
      return day;
    });

    const triggerCounts = new Map();
    let sumMood = 0;
    let sumEnergy = 0;
    let sumStress = 0;
    for (const m of moodEntries) {
      sumMood += m.mood_score;
      sumEnergy += m.energy_level;
      sumStress += m.stress_level;
      for (const t of m.triggers ?? []) {
        const key = t.trim().toLowerCase();
        if (!key) continue;
        triggerCounts.set(key, (triggerCounts.get(key) ?? 0) + 1);
      }
    }

    const entriesCount = moodEntries.length;
    const moodSummary = {
      entriesCount,
      averageMood: entriesCount > 0 ? round2(sumMood / entriesCount) : null,
      averageEnergy: entriesCount > 0 ? round2(sumEnergy / entriesCount) : null,
      averageStress: entriesCount > 0 ? round2(sumStress / entriesCount) : null,
      topTriggers: [...triggerCounts.entries()]
        .map(([trigger, count]) => ({ trigger, count }))
        .sort((a, b) => b.count - a.count || a.trigger.localeCompare(b.trigger))
        .slice(0, 10),
    };

    return {
      period: { from: resolvedFrom, to: resolvedTo },
      habitsSummary,
      moodSummary,
      dailyMatrix,
    };
  }

  function getProjectsAndGoalsDashboard({ referenceDate = null } = {}) {
    const refDate = referenceDate || todayDate();
    const rawGoals = goalService.listGoals({}) || [];
    const rawProjects = projectService.listProjects({}) || [];
    const rawTasks = taskService.listTasks({}) || [];
    const snapshot = specializedSpacesService.getSnapshot();
    const financeSummary = financialTransactionService.getFinancialSummary({});

    const goals = rawGoals.map((g) => {
      const detail = goalService.getGoal(g.id);
      return {
        id: g.id,
        name: g.name,
        status: g.status,
        horizon: g.horizon,
        target_date: g.target_date,
        priority_id: g.priority_id,
        resourceImpact: g.resourceImpact ?? detail.resourceImpact ?? null,
        linkedProjectsCount: detail.projects?.length ?? 0,
        linkedTasksCount: detail.tasks?.length ?? 0,
      };
    });

    const activeGoalsForFeasibility = goals.filter((g) => g.status === 'ACTIVE');
    const feasibility = snapshot.profile
      ? evaluateGoalFeasibility(activeGoalsForFeasibility, {}, snapshot.profile)
      : null;

    const projects = rawProjects
      .filter((p) => p.status !== 'ARCHIVED')
      .map((p) => {
        const progress = projectService.getProjectProgress(p.id);
        const overdueTasksCount = rawTasks.filter(
          (t) =>
            t.project_id === p.id &&
            t.due_date &&
            t.due_date < refDate &&
            !['COMPLETED', 'CANCELLED', 'ARCHIVED'].includes(t.status)
        ).length;
        return {
          ...p,
          progress,
          task_completion_ratio: progress.task_completion_ratio,
          total_active_tasks: progress.total_active_tasks,
          completed_tasks: progress.completed_tasks,
          blocked_tasks: progress.blocked_tasks,
          overdueTasksCount,
        };
      });

    const summary = {
      activeGoals: goals.filter((g) => g.status === 'ACTIVE').length,
      completedGoals: goals.filter((g) => g.status === 'ACHIEVED').length,
      activeProjects: rawProjects.filter((p) => ['PLANNING', 'ACTIVE'].includes(p.status)).length,
      completedProjects: rawProjects.filter((p) => p.status === 'COMPLETED').length,
      pendingTasks: rawTasks.filter((t) => ['PENDING', 'PREPARATION', 'IN_PROGRESS', 'WAITING'].includes(t.status)).length,
      completedTasks: rawTasks.filter((t) => t.status === 'COMPLETED').length,
      blockedTasks: rawTasks.filter((t) => t.status === 'BLOCKED').length,
    };

    return {
      referenceDate: refDate,
      summary,
      goals,
      projects,
      feasibility,
      financeSummary,
    };
  }

  function getMasterCalendar({ year = null, month = null } = {}) {
    const [curY, curM] = todayDate().split('-').map(Number);
    const resolvedYear = year !== null && year !== undefined && year !== '' ? Number(year) : curY;
    const resolvedMonth = month !== null && month !== undefined && month !== '' ? Number(month) : curM;

    if (!Number.isInteger(resolvedYear) || resolvedYear < 1900 || resolvedYear > 2200) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'year debe ser un entero válido.', {
        field: 'year',
      });
    }
    if (!Number.isInteger(resolvedMonth) || resolvedMonth < 1 || resolvedMonth > 12) {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'month debe ser un entero entre 1 y 12.', {
        field: 'month',
      });
    }

    const daysInMonth = new Date(Date.UTC(resolvedYear, resolvedMonth, 0)).getUTCDate();
    const mm = pad2(resolvedMonth);
    const fromDate = `${resolvedYear}-${mm}-01`;
    const toDate = `${resolvedYear}-${mm}-${pad2(daysInMonth)}`;
    const tz = timezone();

    const items = [];
    const snapshot = specializedSpacesService.getSnapshot();
    const payments = snapshot.commitmentPayments || [];

    // 1. Fechas importantes
    const importantDates = wellbeingService.listImportantDates({ month: resolvedMonth, status: 'ACTIVE' }) || [];
    for (const d of importantDates) {
      if (d.recurrence !== 'ANNUAL' && d.year !== resolvedYear) continue;
      const adjustedDay = Math.min(d.day, daysInMonth);
      const dateStr = `${resolvedYear}-${mm}-${pad2(adjustedDay)}`;
      const metadata = {
        category: d.category,
        related_person: d.related_person ?? null,
        recurrence: d.recurrence,
      };
      if (d.category === 'birthday' && Number.isInteger(d.year)) {
        metadata.turnsAge = resolvedYear - d.year;
      }
      items.push({
        id: `imp-${d.id}-${dateStr}`,
        type: 'important_date',
        date: dateStr,
        title: d.title,
        metadata,
      });
    }

    // 2. Pagos recurrentes desde Espacios Especializados
    const recurring = snapshot.profile?.recurringCommitments || [];
    const hasPaidPeriod = (name, periodKey) =>
      payments.some(
        (p) => p.commitmentName.trim().toLowerCase() === name.trim().toLowerCase() && p.periodKey === periodKey
      );

    for (const comm of recurring) {
      const freq = String(comm.frequency || 'monthly').toLowerCase();
      if (freq === 'monthly') {
        const day = Math.min(comm.dueDayOfMonth ?? 1, daysInMonth);
        const dateStr = `${resolvedYear}-${mm}-${pad2(day)}`;
        const periodKey = `${resolvedYear}-${mm}`;
        items.push({
          id: `rec-${comm.name}-${periodKey}`,
          type: 'recurring_payment',
          date: dateStr,
          title: comm.name,
          metadata: {
            amount: comm.amount,
            frequency: freq,
            periodKey,
            paid: hasPaidPeriod(comm.name, periodKey),
          },
        });
      } else if (freq === 'annual') {
        const targetMonth = Number.isInteger(comm.dueMonth) ? comm.dueMonth : 1;
        if (targetMonth === resolvedMonth) {
          const day = Math.min(comm.dueDayOfMonth ?? 1, daysInMonth);
          const dateStr = `${resolvedYear}-${mm}-${pad2(day)}`;
          const periodKey = `${resolvedYear}`;
          items.push({
            id: `rec-${comm.name}-${periodKey}`,
            type: 'recurring_payment',
            date: dateStr,
            title: comm.name,
            metadata: {
              amount: comm.amount,
              frequency: freq,
              periodKey,
              paid: hasPaidPeriod(comm.name, periodKey),
            },
          });
        }
      } else if (freq === 'biweekly') {
        const q1Day = Math.min(
          Number.isInteger(comm.dueDayOfMonth) && comm.dueDayOfMonth <= 15 ? comm.dueDayOfMonth : 15,
          daysInMonth
        );
        const q2Day = Math.min(
          Number.isInteger(comm.dueDayOfMonth) && comm.dueDayOfMonth > 15 ? comm.dueDayOfMonth : 30,
          daysInMonth
        );
        const p1 = `${resolvedYear}-${mm}-Q1`;
        const p2 = `${resolvedYear}-${mm}-Q2`;
        items.push({
          id: `rec-${comm.name}-${p1}`,
          type: 'recurring_payment',
          date: `${resolvedYear}-${mm}-${pad2(q1Day)}`,
          title: `${comm.name} (Q1)`,
          metadata: { amount: comm.amount, frequency: freq, periodKey: p1, paid: hasPaidPeriod(comm.name, p1) },
        });
        items.push({
          id: `rec-${comm.name}-${p2}`,
          type: 'recurring_payment',
          date: `${resolvedYear}-${mm}-${pad2(q2Day)}`,
          title: `${comm.name} (Q2)`,
          metadata: { amount: comm.amount, frequency: freq, periodKey: p2, paid: hasPaidPeriod(comm.name, p2) },
        });
      } else if (freq === 'weekly') {
        for (let day = 1; day <= daysInMonth; day += 1) {
          const dateStr = `${resolvedYear}-${mm}-${pad2(day)}`;
          if (dayOfWeekUtc(dateStr) === 1) {
            const periodKey = computeIsoWeekKey(resolvedYear, resolvedMonth, day);
            items.push({
              id: `rec-${comm.name}-${periodKey}`,
              type: 'recurring_payment',
              date: dateStr,
              title: comm.name,
              metadata: {
                amount: comm.amount,
                frequency: freq,
                periodKey,
                paid: hasPaidPeriod(comm.name, periodKey),
              },
            });
          }
        }
      }
    }

    // 3. Compromisos económicos pendientes
    const finCommitments = financialCommitmentService.listPendingCommitments({}) || [];
    for (const fc of finCommitments) {
      if (!fc.due_date) continue;
      const dateStr = fc.due_date.slice(0, 10);
      if (dateStr >= fromDate && dateStr <= toDate) {
        items.push({
          id: `fincomm-${fc.id}`,
          type: 'financial_commitment',
          date: dateStr,
          title: fc.description,
          metadata: { amount: fc.amount, currency: fc.currency, status: fc.status },
        });
      }
    }

    // 4. Eventos de calendario y compromisos de tiempo en zona horaria local
    const events = calendarService.listEvents({
      from: `${addDays(fromDate, -1)}T00:00:00.000Z`,
      to: `${addDays(toDate, 1)}T23:59:59.999Z`,
    }) || [];
    for (const ev of events) {
      if (ev.status === 'CANCELLED') continue;
      const localDate = formatDateInTimeZone(ev.start_at, tz);
      if (localDate >= fromDate && localDate <= toDate) {
        items.push({
          id: `ev-${ev.id}`,
          type: 'calendar_event',
          date: localDate,
          title: ev.title,
          metadata: {
            startTime: formatTimeInTimeZone(ev.start_at, tz),
            endTime: formatTimeInTimeZone(ev.end_at, tz),
            status: ev.status,
          },
        });
      }
    }

    const timeCommitments = commitmentService.listCommitments({}) || [];
    for (const tc of timeCommitments) {
      if (['COMPLETED', 'CANCELLED'].includes(tc.status)) continue;
      const refIso = tc.start_at || tc.due_at;
      if (!refIso) continue;
      const localDate = formatDateInTimeZone(refIso, tz);
      if (localDate >= fromDate && localDate <= toDate) {
        items.push({
          id: `tc-${tc.id}`,
          type: 'time_commitment',
          date: localDate,
          title: tc.title,
          metadata: {
            time: formatTimeInTimeZone(refIso, tz),
            commitment_type: tc.commitment_type,
            status: tc.status,
          },
        });
      }
    }

    // 5. Baselines semanales selladas
    for (const b of specializedSpacesService.listBaselines()) {
      if (b.weekStartDate && b.weekStartDate >= fromDate && b.weekStartDate <= toDate) {
        items.push({
          id: `base-${b.baselineId}`,
          type: 'weekly_baseline',
          date: b.weekStartDate,
          title: `Semana sellada (${b.baselineId})`,
          metadata: {
            baselineId: b.baselineId,
            executionsCount: b.executionsCount,
            revisionsCount: b.revisionsCount,
          },
        });
      }
    }

    items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.type.localeCompare(b.type) ||
        a.title.localeCompare(b.title)
    );

    const itemsByDate = new Map();
    for (const item of items) {
      if (!itemsByDate.has(item.date)) itemsByDate.set(item.date, []);
      itemsByDate.get(item.date).push(item);
    }

    const days = [];
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateStr = `${resolvedYear}-${mm}-${pad2(day)}`;
      const dow = dayOfWeekUtc(dateStr);
      const dayItems = itemsByDate.get(dateStr) ?? [];
      days.push({
        date: dateStr,
        dayOfMonth: day,
        dayOfWeek: dow,
        isSaturday: dow === 6,
        items: dayItems,
      });
    }

    return {
      year: resolvedYear,
      month: resolvedMonth,
      fromDate,
      toDate,
      totalItems: items.length,
      items,
      days,
    };
  }

  return {
    getHabitsAndMoodDashboard,
    getProjectsAndGoalsDashboard,
    getMasterCalendar,
  };
}
