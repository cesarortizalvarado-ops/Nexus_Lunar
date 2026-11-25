import { createNexusCore } from '../core/nexus-core.js';

const args = process.argv.slice(2);
const [command, rawId] = args;
const idFlagIdx = args.indexOf('--id');
const targetId = idFlagIdx >= 0 ? args[idFlagIdx + 1] : (rawId && !rawId.startsWith('--') ? rawId : null);
const confirmed = args.includes('--confirm-restore');

const core = createNexusCore();

async function main() {
  try {
    let resp;
    if (command === 'backup') {
      resp = await core.executeOperationAsync({ operation_type: 'backup.create', payload: { reason: 'manual' } });
    } else if (command === 'list') {
      resp = await core.executeOperationAsync({ operation_type: 'backup.list' });
    } else if (command === 'verify' && targetId) {
      resp = await core.executeOperationAsync({ operation_type: 'backup.verify', payload: { id: targetId } });
      if (resp.success && !resp.result?.ok) process.exitCode = 1;
    } else if (command === 'restore' && targetId) {
      resp = await core.executeOperationAsync({
        operation_type: 'restore.execute',
        payload: { id: targetId },
        authorization: confirmed ? { approved: true, authorized_by: 'DB_CLI_USER', scope: 'restore.execute' } : null,
      });
    } else {
      console.error('Uso: npm run db:backup | db:list | db:verify -- <backup_id> | db:restore -- <backup_id> --confirm-restore');
      process.exitCode = 2;
      return;
    }

    if (!resp.success) {
      const e = resp.errors?.[0] ?? {};
      console.error(JSON.stringify({ error: e.code ?? 'ERROR', message: e.description, remediation: e.remediation ?? null }, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(resp.result, null, 2));
  } finally {
    core.shutdown();
  }
}

main();
