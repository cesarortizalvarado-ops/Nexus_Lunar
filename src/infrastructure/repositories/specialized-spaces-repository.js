import fs from 'node:fs';
import path from 'node:path';

export function createEmptySpacesState() {
  return {
    schemaVersion: 1,
    updatedAt: null,
    profile: null,
    biometricsUpdatedAt: null,
    commitmentPayments: [],
    baselines: {},
    executionLogs: {},
    revisionsLogs: {},
  };
}

function createSqliteSpacesRepository(persistenceService) {
  function loadState() {
    const db = persistenceService.getReadDatabase();
    const state = createEmptySpacesState();

    const profileRow = db
      .prepare("SELECT profile_json, biometrics_updated_at, updated_at FROM specialized_spaces_profile WHERE id = 'default'")
      .get();

    if (profileRow) {
      state.profile = JSON.parse(profileRow.profile_json);
      state.biometricsUpdatedAt = profileRow.biometrics_updated_at ?? null;
      state.updatedAt = profileRow.updated_at ?? null;
    }

    const paymentRows = db
      .prepare('SELECT id, commitment_name, amount, period_key, paid_at, notes FROM specialized_commitment_payments ORDER BY rowid ASC')
      .all();
    state.commitmentPayments = paymentRows.map((r) => ({
      id: r.id,
      commitmentName: r.commitment_name,
      amount: r.amount,
      periodKey: r.period_key,
      paidAt: r.paid_at,
      notes: r.notes ?? null,
    }));

    const baselineRows = db
      .prepare('SELECT baseline_id, baseline_json FROM specialized_weekly_baselines ORDER BY approved_at ASC')
      .all();
    for (const row of baselineRows) {
      const parsedBaseline = JSON.parse(row.baseline_json);
      state.baselines[row.baseline_id] = parsedBaseline;
      state.executionLogs[row.baseline_id] = [];
      state.revisionsLogs[row.baseline_id] = [];
    }

    const executionRows = db
      .prepare('SELECT baseline_id, block_id, status, reason, notes, recorded_at FROM specialized_baseline_executions ORDER BY seq ASC')
      .all();
    for (const row of executionRows) {
      if (!state.executionLogs[row.baseline_id]) {
        state.executionLogs[row.baseline_id] = [];
      }
      state.executionLogs[row.baseline_id].push({
        baselineId: row.baseline_id,
        blockId: row.block_id,
        status: row.status,
        reason: row.reason ?? null,
        notes: row.notes ?? null,
        recordedAt: row.recorded_at,
      });
    }

    const revisionRows = db
      .prepare('SELECT baseline_id, original_block_id, change_type, new_window_json, reason, authorized_by, recorded_at FROM specialized_baseline_revisions ORDER BY seq ASC')
      .all();
    for (const row of revisionRows) {
      if (!state.revisionsLogs[row.baseline_id]) {
        state.revisionsLogs[row.baseline_id] = [];
      }
      state.revisionsLogs[row.baseline_id].push({
        baselineId: row.baseline_id,
        originalBlockId: row.original_block_id,
        changeType: row.change_type,
        newWindow: row.new_window_json ? JSON.parse(row.new_window_json) : null,
        reason: row.reason,
        authorizedBy: row.authorized_by,
        recordedAt: row.recorded_at,
      });
    }

    return state;
  }

  function saveState(nextState) {
    const db = persistenceService.getDatabase();
    const resolvedUpdatedAt = nextState.updatedAt || new Date().toISOString();

    if (nextState.profile) {
      db.prepare(`
        INSERT OR REPLACE INTO specialized_spaces_profile (id, profile_json, biometrics_updated_at, updated_at)
        VALUES ('default', ?, ?, ?)
      `).run(
        JSON.stringify(nextState.profile),
        nextState.biometricsUpdatedAt ?? null,
        resolvedUpdatedAt
      );
    }

    const insertPaymentStmt = db.prepare(`
      INSERT OR IGNORE INTO specialized_commitment_payments (id, commitment_name, amount, period_key, paid_at, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const p of nextState.commitmentPayments || []) {
      insertPaymentStmt.run(
        p.id,
        p.commitmentName,
        p.amount,
        p.periodKey,
        p.paidAt,
        p.notes ?? null
      );
    }

    const insertBaselineStmt = db.prepare(`
      INSERT OR IGNORE INTO specialized_weekly_baselines (
        baseline_id, week_start_date, status, approved_at, approved_by, integrity_hash, baseline_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const b of Object.values(nextState.baselines || {})) {
      insertBaselineStmt.run(
        b.baselineId,
        b.plan?.weekStartDate ?? '',
        b.status,
        b.approvedAt,
        b.approvedBy ?? 'user',
        b.integrityHash,
        JSON.stringify(b)
      );
    }

    const countExecStmt = db.prepare('SELECT COUNT(*) AS c FROM specialized_baseline_executions WHERE baseline_id = ?');
    const insertExecStmt = db.prepare(`
      INSERT INTO specialized_baseline_executions (baseline_id, block_id, status, reason, notes, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const [baselineId, entries] of Object.entries(nextState.executionLogs || {})) {
      const existingCount = countExecStmt.get(baselineId)?.c ?? 0;
      const newEntries = Array.isArray(entries) ? entries.slice(existingCount) : [];
      for (const entry of newEntries) {
        insertExecStmt.run(
          baselineId,
          entry.blockId,
          entry.status,
          entry.reason ?? null,
          entry.notes ?? null,
          entry.recordedAt
        );
      }
    }

    const countRevStmt = db.prepare('SELECT COUNT(*) AS c FROM specialized_baseline_revisions WHERE baseline_id = ?');
    const insertRevStmt = db.prepare(`
      INSERT INTO specialized_baseline_revisions (
        baseline_id, original_block_id, change_type, new_window_json, reason, authorized_by, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [baselineId, entries] of Object.entries(nextState.revisionsLogs || {})) {
      const existingCount = countRevStmt.get(baselineId)?.c ?? 0;
      const newEntries = Array.isArray(entries) ? entries.slice(existingCount) : [];
      for (const entry of newEntries) {
        insertRevStmt.run(
          baselineId,
          entry.originalBlockId,
          entry.changeType ?? 'reschedule',
          entry.newWindow ? JSON.stringify(entry.newWindow) : null,
          entry.reason,
          entry.authorizedBy,
          entry.recordedAt
        );
      }
    }

    return loadState();
  }

  return {
    persistenceService,
    loadState,
    saveState,
  };
}

export function createSpecializedSpacesRepository({ persistenceService = null, filePath = null } = {}) {
  if (persistenceService) {
    return createSqliteSpacesRepository(persistenceService);
  }

  let memoryState = createEmptySpacesState();

  function loadState() {
    if (!filePath) {
      return structuredClone(memoryState);
    }
    if (!fs.existsSync(filePath)) {
      return createEmptySpacesState();
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...createEmptySpacesState(),
      ...parsed,
    };
  }

  function saveState(nextState) {
    const snapshot = structuredClone({
      ...createEmptySpacesState(),
      ...nextState,
      updatedAt: nextState.updatedAt || new Date().toISOString(),
    });

    if (!filePath) {
      memoryState = snapshot;
      return structuredClone(memoryState);
    }

    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), 'utf8');
    fs.renameSync(tempPath, filePath);
    return snapshot;
  }

  return {
    filePath,
    loadState,
    saveState,
  };
}
