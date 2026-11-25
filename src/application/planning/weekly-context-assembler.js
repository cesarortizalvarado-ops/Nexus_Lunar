import { validateRecipe } from '../../domain/knowledge/recipe-contract.js';

const WEEKDAY_MAP = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getLocalDateParts(isoString, timezone = 'UTC') {
  if (!isoString) return null;
  const dt = new Date(isoString);
  if (Number.isNaN(dt.getTime())) return null;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(dt).map((p) => [p.type, p.value]));
  const hourNum = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
  const minuteNum = Number(parts.minute);
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAY_MAP[parts.weekday],
    hour: Number((hourNum + minuteNum / 60).toFixed(2)),
  };
}

function parseIsoDayAndHour(isoString, weekStartDate, timezone = 'UTC') {
  const local = getLocalDateParts(isoString, timezone);
  if (!local) return null;
  const weekEndDate = addDaysIso(weekStartDate, 7);
  if (local.dateStr < weekStartDate || local.dateStr >= weekEndDate) return null;
  return { dayOfWeek: local.dayOfWeek, hour: local.hour, dateStr: local.dateStr };
}

function tryExtractRecipeFromDocument(doc) {
  if (!doc || typeof doc !== 'object') return null;
  let candidate = null;

  if (doc.metadata && typeof doc.metadata === 'object' && doc.metadata.recipe) {
    candidate = doc.metadata.recipe;
  } else if (typeof doc.content === 'string' && doc.content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(doc.content);
      if (parsed && parsed.category && parsed.macros && Array.isArray(parsed.ingredients)) {
        candidate = { id: parsed.id || doc.id, name: parsed.name || doc.title, ...parsed };
      }
    } catch {
      return null;
    }
  }

  if (!candidate) return null;
  try {
    validateRecipe(candidate);
    return candidate;
  } catch {
    return null;
  }
}

export function createWeeklyContextAssembler({
  goalService,
  calendarService,
  commitmentService,
  productService,
  inventoryService,
  knowledgeDocumentService,
  clock,
}) {
  function assembleWeeklyInputs({
    weekStartDate,
    activeGoals = null,
    fixedCommitments = null,
    libraries = null,
    currentInventory = null,
  } = {}) {
    const resolvedWeekStart = weekStartDate || clock.todayDate();
    const tz = clock?.timezone ?? 'UTC';

    // 1. Metas activas desde personal-repository (si no se pasan explícitamente)
    let resolvedGoals = activeGoals;
    if (!Array.isArray(resolvedGoals)) {
      const rawGoals = goalService?.listGoals ? goalService.listGoals({}) : [];
      resolvedGoals = (Array.isArray(rawGoals) ? rawGoals : [])
        .filter((g) => !['COMPLETED', 'ARCHIVED', 'CANCELLED'].includes(String(g.status || '').toUpperCase()))
        .map((g) => ({
          id: g.id,
          title: g.name || g.title || g.id,
          resourceImpact: g.resourceImpact || g.resource_impact || g.metadata?.resourceImpact || null,
        }));
    }

    // 2. Compromisos y eventos fijos dentro de los 7 días de la semana en la zona horaria local
    let resolvedCommitments = fixedCommitments;
    if (!Array.isArray(resolvedCommitments)) {
      resolvedCommitments = [];
      const queryFrom = `${addDaysIso(resolvedWeekStart, -1)}T00:00:00.000Z`;
      const queryTo = `${addDaysIso(resolvedWeekStart, 8)}T23:59:59.999Z`;

      const events = calendarService?.listEvents
        ? calendarService.listEvents({ from: queryFrom, to: queryTo })
        : [];
      for (const ev of Array.isArray(events) ? events : []) {
        if (String(ev.status || '').toUpperCase() === 'CANCELLED') continue;
        const startInfo = parseIsoDayAndHour(ev.start_at || ev.startAt, resolvedWeekStart, tz);
        const endInfo = parseIsoDayAndHour(ev.end_at || ev.endAt, resolvedWeekStart, tz);
        if (startInfo && endInfo && startInfo.dayOfWeek === endInfo.dayOfWeek && endInfo.hour > startInfo.hour) {
          resolvedCommitments.push({
            id: ev.id,
            title: ev.title || 'Evento de calendario',
            dayOfWeek: startInfo.dayOfWeek,
            startHour: startInfo.hour,
            endHour: endInfo.hour,
          });
        }
      }

      const rawCommitments = commitmentService?.listCommitments ? commitmentService.listCommitments({}) : [];
      for (const c of Array.isArray(rawCommitments) ? rawCommitments : []) {
        if (['COMPLETED', 'CANCELLED'].includes(String(c.status || '').toUpperCase())) continue;
        const startInfo = parseIsoDayAndHour(c.start_at || c.due_at, resolvedWeekStart, tz);
        if (!startInfo) continue;

        let endHour = null;
        if (c.end_at) {
          const endInfo = parseIsoDayAndHour(c.end_at, resolvedWeekStart, tz);
          if (endInfo && endInfo.dayOfWeek === startInfo.dayOfWeek) {
            endHour = endInfo.hour;
          }
        } else {
          endHour = Math.min(24, Number((startInfo.hour + 1).toFixed(2)));
        }

        if (endHour !== null && endHour > startInfo.hour) {
          resolvedCommitments.push({
            id: c.id,
            title: c.title || c.name || 'Compromiso',
            dayOfWeek: startInfo.dayOfWeek,
            startHour: startInfo.hour,
            endHour,
          });
        }
      }
    }

    // 3. Inventario actual consolidado con productos y costos unitarios si existen
    let resolvedInventory = currentInventory;
    if (!Array.isArray(resolvedInventory)) {
      const products = productService?.listProducts ? productService.listProducts({}) : [];
      const stockRows = inventoryService?.getInventory ? inventoryService.getInventory(null) : [];
      const stockByProduct = new Map();

      for (const row of Array.isArray(stockRows) ? stockRows : []) {
        const pid = row.product_id || row.productId;
        if (!pid) continue;
        const qty = Number(row.quantity ?? row.available_quantity ?? row.availableQuantity ?? 0);
        stockByProduct.set(pid, (stockByProduct.get(pid) || 0) + qty);
      }

      resolvedInventory = (Array.isArray(products) ? products : []).map((prod) => ({
        itemId: prod.id,
        itemName: prod.name,
        availableQuantity: stockByProduct.get(prod.id) ?? 0,
        unit: prod.unit || prod.default_unit || 'unit',
        unitCost:
          typeof prod.unit_cost === 'number'
            ? prod.unit_cost
            : typeof prod.metadata?.unitCost === 'number'
              ? prod.metadata.unitCost
              : typeof prod.reference_price_minor === 'number'
                ? Number((prod.reference_price_minor / 100).toFixed(2))
                : undefined,
      }));
    }

    // 4. Biblioteca de recetas desde knowledgeDocumentService
    let resolvedLibraries = libraries;
    if (!resolvedLibraries || !Array.isArray(resolvedLibraries.recipes)) {
      const docs = knowledgeDocumentService?.searchDocuments ? knowledgeDocumentService.searchDocuments({}) : [];
      const recipes = [];
      for (const doc of Array.isArray(docs) ? docs : []) {
        const recipe = tryExtractRecipeFromDocument(doc);
        if (recipe) recipes.push(recipe);
      }
      resolvedLibraries = {
        ...(resolvedLibraries || {}),
        recipes,
      };
    }

    return {
      weekStartDate: resolvedWeekStart,
      activeGoals: resolvedGoals,
      fixedCommitments: resolvedCommitments,
      libraries: resolvedLibraries,
      currentInventory: resolvedInventory,
    };
  }

  return {
    assembleWeeklyInputs,
  };
}
