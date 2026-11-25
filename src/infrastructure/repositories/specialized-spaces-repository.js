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

export function createSpecializedSpacesRepository({ filePath = null } = {}) {
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
