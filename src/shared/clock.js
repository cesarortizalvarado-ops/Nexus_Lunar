import { ERROR_CODES, NexusError } from './errors.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TIME_WITH_SEC_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const formatterCache = new Map();

function getFormatter(timeZone) {
  const tz = timeZone || 'UTC';
  let fmt = formatterCache.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatterCache.set(tz, fmt);
  }
  return fmt;
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTime(value) {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function isValidIsoDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATETIME_RE.test(value)) return false;
  return !Number.isNaN(new Date(value).getTime());
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function assertValidTimeZone(tz) {
  const normalized = tz || 'UTC';
  if (!isValidTimeZone(normalized)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Zona horaria IANA inválida: ${tz}`, { field: 'timezone' });
  }
  return normalized;
}

export function getZonedParts(dateOrIso, timeZone = 'UTC') {
  const tz = assertValidTimeZone(timeZone);
  const d = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  if (Number.isNaN(d.getTime())) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Fecha/hora inválida: ${dateOrIso}`);
  }
  const parts = getFormatter(tz).formatToParts(d);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    dateStr: `${map.year}-${map.month}-${map.day}`,
    timeStr: `${map.hour}:${map.minute}`,
  };
}

export function formatDateInTimeZone(dateOrIso, timeZone = 'UTC') {
  return getZonedParts(dateOrIso, timeZone).dateStr;
}

export function formatTimeInTimeZone(dateOrIso, timeZone = 'UTC') {
  return getZonedParts(dateOrIso, timeZone).timeStr;
}

export function toUtcIso(value) {
  return new Date(value).toISOString();
}

export function minutesBetween(startIso, endIso) {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

export function addDays(dateStr, days) {
  if (!isValidDate(dateStr)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Fecha civil inválida: ${dateStr}`);
  }
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

export function dayOfWeekUtc(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}

export function dayOfWeekInTz(dateOrIso, timeZone = 'UTC') {
  if (typeof dateOrIso === 'string' && DATE_RE.test(dateOrIso)) {
    return dayOfWeekUtc(dateOrIso);
  }
  const civilDate = formatDateInTimeZone(dateOrIso, timeZone);
  return dayOfWeekUtc(civilDate);
}

/**
 * Convierte una fecha civil (YYYY-MM-DD) y hora local (HH:MM o HH:MM:SS) en una zona horaria IANA
 * a su instante exacto ISO-8601 en UTC, convergiendo en 2 pasos para respetar cambios DST.
 */
export function localDateTimeToUtcIso(dateStr, timeStr = '00:00:00', timeZone = 'UTC', ms = 0) {
  if (!isValidDate(dateStr)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Fecha civil inválida: ${dateStr}`, { field: 'date' });
  }
  const match = typeof timeStr === 'string' ? TIME_WITH_SEC_RE.exec(timeStr) : null;
  if (!match) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Hora local inválida: ${timeStr}`, { field: 'time' });
  }
  const tz = assertValidTimeZone(timeZone);
  const [year, month, day] = dateStr.split('-').map(Number);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);

  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);

  const p1 = getZonedParts(new Date(targetAsUtcMs), tz);
  const p1AsUtcMs = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second, ms);
  const offset1 = p1AsUtcMs - targetAsUtcMs;
  const guess2 = targetAsUtcMs - offset1;

  const p2 = getZonedParts(new Date(guess2), tz);
  const p2AsUtcMs = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second, ms);
  const offset2 = p2AsUtcMs - guess2;

  return new Date(targetAsUtcMs - offset2).toISOString();
}

export function localDateBoundsToUtc(dateStr, timeZone = 'UTC') {
  const startUtc = localDateTimeToUtcIso(dateStr, '00:00:00', timeZone, 0);
  const nextDayStartUtc = localDateTimeToUtcIso(addDays(dateStr, 1), '00:00:00', timeZone, 0);
  const endUtc = new Date(new Date(nextDayStartUtc).getTime() - 1).toISOString();
  return { startUtc, endUtc, nextDayStartUtc, date: dateStr, timezone: timeZone };
}

export function localTimeWindowToUtc(dateStr, startHHMM, endHHMM, timeZone = 'UTC') {
  if (!isValidTime(startHHMM) || !isValidTime(endHHMM)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, `Ventana horaria inválida: ${startHHMM}-${endHHMM}`);
  }
  const startUtc = localDateTimeToUtcIso(dateStr, `${startHHMM}:00`, timeZone, 0);
  const endDateStr = endHHMM <= startHHMM ? addDays(dateStr, 1) : dateStr;
  const endUtc = localDateTimeToUtcIso(endDateStr, `${endHHMM}:00`, timeZone, 0);
  return { startUtc, endUtc, date: dateStr, timezone: timeZone };
}

export function createClock(optionsOrNowFn = {}) {
  const opts = typeof optionsOrNowFn === 'function'
    ? { nowFn: optionsOrNowFn, timezone: 'UTC' }
    : (optionsOrNowFn ?? {});
  const nowFn = typeof opts.nowFn === 'function' ? opts.nowFn : () => new Date();
  const defaultTz = assertValidTimeZone(opts.timezone || 'UTC');

  return {
    get timezone() {
      return defaultTz;
    },
    now: () => nowFn(),
    nowIso: () => nowFn().toISOString(),
    todayDate: (tz = defaultTz) => formatDateInTimeZone(nowFn(), tz),
    formatDate: (dateOrIso, tz = defaultTz) => formatDateInTimeZone(dateOrIso, tz),
    formatTime: (dateOrIso, tz = defaultTz) => formatTimeInTimeZone(dateOrIso, tz),
    dayOfWeek: (dateOrIso, tz = defaultTz) => dayOfWeekInTz(dateOrIso, tz),
    dateBoundsUtc: (dateStr, tz = defaultTz) => localDateBoundsToUtc(dateStr, tz),
    timeWindowUtc: (dateStr, startHHMM, endHHMM, tz = defaultTz) => localTimeWindowToUtc(dateStr, startHHMM, endHHMM, tz),
  };
}
