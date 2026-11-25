import { verifyBaselineIntegrity } from '../../domain/planning/weekly-baseline-contract.js';

export function createDoctorService({
  storageHealthService,
  backupService,
  specializedSpacesService,
  weeklyContextAssembler,
  clock,
  ollamaProbe = null,
}) {
  async function runDiagnostics({ referenceDate = null } = {}) {
    const refDate = referenceDate || clock.todayDate();

    const rawStorage = storageHealthService.inspectStorage();
    const storageOk = Boolean(
      rawStorage?.integrity?.ok &&
      rawStorage?.files_integrity?.ok &&
      !rawStorage?.recovery?.recovery_mode
    );
    const storage = {
      ...rawStorage,
      ok: storageOk,
      schema_version: rawStorage?.metadata?.schema_version ?? rawStorage?.migrations?.current_version ?? null,
    };
    const backupsList = backupService.listBackups() || [];
    const backups = {
      count: backupsList.length,
      latestBackupId: backupsList[0]?.id ?? null,
      latestBackupAt: backupsList[0]?.created_at ?? null,
    };

    const snapshot = specializedSpacesService.getSnapshot();
    const profileInitialized = Boolean(snapshot.profile);
    const biometricFreshness = specializedSpacesService.checkBiometricFreshness(refDate);
    const unpaidCommitments = specializedSpacesService.detectUnpaidCommitments(refDate);

    const spaces = {
      profileInitialized,
      biometricFreshness,
      unpaidCommitmentsCount: unpaidCommitments.length,
      unpaidCommitments,
    };

    const baselineList = Object.values(snapshot.baselines || {});
    let validCount = 0;
    const corruptedIds = [];
    for (const b of baselineList) {
      const check = verifyBaselineIntegrity(b);
      if (check.valid) {
        validCount += 1;
      } else {
        corruptedIds.push(b?.baselineId || 'UNKNOWN');
      }
    }
    const baselines = {
      total: baselineList.length,
      validCount,
      corruptedIds,
    };

    const assembled = weeklyContextAssembler.assembleWeeklyInputs({ weekStartDate: refDate });
    const libraries = {
      recipesCount: assembled.libraries?.recipes?.length ?? 0,
      inventoryProductsCount: assembled.currentInventory?.length ?? 0,
      activeGoalsCount: assembled.activeGoals?.length ?? 0,
    };

    const ai = ollamaProbe
      ? await ollamaProbe()
      : { configured: false, available: false, mode: 'deterministic_only', models: [] };

    const recommendations = [];
    if (!storage.ok) {
      recommendations.push('El almacenamiento SQLite reporta problemas de integridad; inspecciona storageHealthService y restaura un respaldo.');
    }
    if (corruptedIds.length > 0) {
      recommendations.push(`Se detectaron baselines con firma SHA-256 inválida: ${corruptedIds.join(', ')}.`);
    }
    if (!profileInitialized) {
      recommendations.push('Inicializa tu Perfil Personal en Espacios Especializados para habilitar el planificador semanal.');
    }
    if (libraries.recipesCount === 0) {
      recommendations.push('Carga la biblioteca semilla inicial (knowledge.seedStarter) para contar con recetas e ingredientes.');
    }
    if (backups.count === 0) {
      recommendations.push('Crea un primer respaldo local (backup.create) antes de iniciar tu semana.');
    }
    if (profileInitialized && biometricFreshness.isStale) {
      recommendations.push(biometricFreshness.message || 'Actualiza tu peso biométrico.');
    }
    if (unpaidCommitments.length > 0) {
      recommendations.push(`Hay ${unpaidCommitments.length} compromiso(s) recurrente(s) pendiente(s) de pago en el periodo actual.`);
    }

    let status = 'OK';
    if (!storage.ok || corruptedIds.length > 0) {
      status = 'ERROR';
    } else if (
      !profileInitialized ||
      libraries.recipesCount === 0 ||
      backups.count === 0 ||
      unpaidCommitments.length > 0 ||
      biometricFreshness.isStale
    ) {
      status = 'WARN';
    }

    return {
      status,
      checkedAt: clock.nowIso(),
      referenceDate: refDate,
      checks: {
        storage,
        backups,
        spaces,
        baselines,
        libraries,
        ai,
      },
      recommendations,
    };
  }

  return {
    runDiagnostics,
  };
}
