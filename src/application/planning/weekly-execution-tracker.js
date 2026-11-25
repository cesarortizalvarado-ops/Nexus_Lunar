import {
  validateExecutionRecord,
  verifyBaselineIntegrity,
} from '../../domain/planning/weekly-baseline-contract.js';

function indexBaselineBlocks(baseline) {
  const map = new Map();
  for (const day of baseline.plan.dailySchedules) {
    for (const block of day.blocks) {
      map.set(block.id, block);
    }
  }
  return map;
}

export function recordBlockExecution(baseline, existingLog = [], record) {
  const integrity = verifyBaselineIntegrity(baseline);
  if (!integrity.valid) {
    throw new Error(`BASELINE_INTEGRITY_FAILED: ${integrity.reason}`);
  }
  validateExecutionRecord(record);

  const blockIndex = indexBaselineBlocks(baseline);
  if (!blockIndex.has(record.blockId)) {
    throw new Error(`UNKNOWN_BASELINE_BLOCK: El bloque ${record.blockId} no pertenece a la baseline ${baseline.baselineId}.`);
  }

  const entry = Object.freeze({
    baselineId: baseline.baselineId,
    blockId: record.blockId,
    status: record.status,
    reason: record.reason || null,
    notes: record.notes || null,
    recordedAt: record.recordedAt || new Date().toISOString(),
  });

  return [...existingLog, entry];
}

export function recordPlanRevision(baseline, existingRevisions = [], revision) {
  const integrity = verifyBaselineIntegrity(baseline);
  if (!integrity.valid) {
    throw new Error(`BASELINE_INTEGRITY_FAILED: ${integrity.reason}`);
  }
  if (!revision || !revision.originalBlockId || !revision.reason || !revision.authorizedBy) {
    throw new Error('INVALID_REVISION: Se requiere originalBlockId, reason y authorizedBy.');
  }

  const blockIndex = indexBaselineBlocks(baseline);
  if (!blockIndex.has(revision.originalBlockId)) {
    throw new Error(`UNKNOWN_BASELINE_BLOCK: El bloque ${revision.originalBlockId} no existe en la baseline.`);
  }

  const entry = Object.freeze({
    baselineId: baseline.baselineId,
    originalBlockId: revision.originalBlockId,
    changeType: revision.changeType || 'reschedule',
    newWindow: revision.newWindow || null,
    reason: revision.reason,
    authorizedBy: revision.authorizedBy,
    recordedAt: revision.recordedAt || new Date().toISOString(),
  });

  return [...existingRevisions, entry];
}

export function closeWeekAndAnalyze(baseline, executionLog = [], revisionsLog = []) {
  const integrity = verifyBaselineIntegrity(baseline);
  if (!integrity.valid) {
    throw new Error(`BASELINE_INTEGRITY_FAILED: ${integrity.reason}`);
  }

  // Tomar el último estado registrado por cada blockId
  const latestByBlock = new Map();
  for (const entry of executionLog) {
    latestByBlock.set(entry.blockId, entry);
  }

  const statusCounts = {
    completed: 0,
    partial: 0,
    postponed: 0,
    interrupted: 0,
    blocked: 0,
    cancelled: 0,
    missed_with_reason: 0,
    off_schedule: 0,
    unconfirmed: 0,
  };

  const adherenceByCategory = {};
  const frictionMap = new Map();
  let totalTrackableBlocks = 0;

  for (const day of baseline.plan.dailySchedules) {
    for (const block of day.blocks) {
      if (block.category === 'sleep') continue; // Sueño es restricción base, no tarea accionable
      totalTrackableBlocks++;

      const record = latestByBlock.get(block.id);
      const finalStatus = record ? record.status : 'unconfirmed';
      statusCounts[finalStatus]++;

      if (!adherenceByCategory[block.category]) {
        adherenceByCategory[block.category] = { total: 0, completed: 0, unconfirmed: 0 };
      }
      adherenceByCategory[block.category].total++;
      if (finalStatus === 'completed') adherenceByCategory[block.category].completed++;
      if (finalStatus === 'unconfirmed') adherenceByCategory[block.category].unconfirmed++;

      if (record && record.reason && finalStatus !== 'completed') {
        const key = record.reason.trim();
        if (!frictionMap.has(key)) {
          frictionMap.set(key, { reason: key, count: 0, affectedBlockIds: [] });
        }
        const agg = frictionMap.get(key);
        agg.count++;
        agg.affectedBlockIds.push(block.id);
      }
    }
  }

  const confirmedBlocks = totalTrackableBlocks - statusCounts.unconfirmed;
  const confirmedCompletionRate =
    confirmedBlocks > 0 ? Number((statusCounts.completed / confirmedBlocks).toFixed(4)) : 0;
  const overallCompletionRate =
    totalTrackableBlocks > 0 ? Number((statusCounts.completed / totalTrackableBlocks).toFixed(4)) : 0;

  return {
    baselineId: baseline.baselineId,
    weekStartDate: baseline.plan.weekStartDate,
    integrityVerified: true,
    totalTrackableBlocks,
    confirmedBlocks,
    unconfirmedBlocks: statusCounts.unconfirmed,
    statusCounts,
    confirmedCompletionRate,
    overallCompletionRate,
    revisionsCount: revisionsLog.length,
    adherenceByCategory,
    documentedFrictionReasons: Array.from(frictionMap.values()).sort((a, b) => b.count - a.count),
  };
}
