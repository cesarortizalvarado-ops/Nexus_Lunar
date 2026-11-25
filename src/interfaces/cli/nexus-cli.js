#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createNexusCore } from '../../core/nexus-core.js';

function usage(write = console.log) {
  write(`Nexus Lunar CLI — Operación local del núcleo a través de OperationDispatcher (sin interfaz gráfica ni IA)

Uso:
  node src/interfaces/cli/nexus-cli.js <dominio> [accion] [id_opcional] [opciones]
  node src/interfaces/cli/nexus-cli.js op <operation_type> [--json '{...}'] [--idempotency-key <k>] [--authorized-by <usuario>]
  node src/interfaces/cli/nexus-cli.js catalog [--module <id>] [--kind QUERY|MUTATION]

Dominios y acciones principales:
  system init|status|version
  modules list|enable|disable [<id> | --id <id>]
  memory create|list|history [--type FACT] [--content "..."] [<id> | --id <id>]
  goals create|list [--name "..."]
  projects create|list|progress [--name "..."] [<id> | --id <id>]
  tasks create|list|status [--title "..."] [<id> | --id <id>] [--status COMPLETED]
  habits create|list|occur|stats [--name "..."] [<id> | --id <id>] [--date YYYY-MM-DD] [--status COMPLETED]
  routines create|list|start [--name "..."] [<id> | --id <id>]
  calendar create|list|conflicts [--title "..."] [--start ISO] [--end ISO]
  availability add|free [--start ISO] [--end ISO] [--type CONFIRMED]
  executions start|list [--entity-type task] [--entity-id <id>]
  finance account|income|expense|summary [--name "..."] [--currency MXN] [--account-id <id>] [--amount 100]
  inventory product|stock|replenishment [--name "..."] [--unit g] [<id> | --id <id>]
  libraries create|list|seed|import|export [--name "..."] [<id> | --id <id>] [--format MARKDOWN|CSV|JSON|XLSX] [--file path]
  doctor [--date YYYY-MM-DD]
  planning weekly|daily|approve|review|close [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--date YYYY-MM-DD] [--proposal-id <id>]
  spaces snapshot|unpaid|pay [--date YYYY-MM-DD] [--name "..."] [--amount 100]
  saturday prepare|baselines|baseline [<id>] [--start YYYY-MM-DD] [--budget 1000] [--date YYYY-MM-DD]
  dashboard habits|projects|calendar [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--date YYYY-MM-DD]
  copilot draft|chat --text "<texto>" [--id <conversation_id>] [--date YYYY-MM-DD]
  adaptation patterns|suggestions|accept|apply [<id> | --id <id>] [--authorized-by <usuario>]
  audit list [--limit 20]
  health inspect
  backup create|list|verify [<backup_id> | --id <backup_id>] [--reason manual]
  restore inspect|validate|execute [<backup_id> | --id <backup_id>] [--confirm-restore] [--authorized-by <usuario>]`);
}

export async function runCli(argv = process.argv.slice(2), configOverrides = {}, io = {}) {
  const out = io.stdout ?? (txt => console.log(txt));
  const errOut = io.stderr ?? (txt => console.error(txt));
  const print = data => out(JSON.stringify(data, null, 2));

  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: false,
    options: {
      id: { type: 'string' },
      name: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      type: { type: 'string' },
      status: { type: 'string' },
      date: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      currency: { type: 'string' },
      amount: { type: 'string' },
      'account-id': { type: 'string' },
      unit: { type: 'string' },
      format: { type: 'string' },
      file: { type: 'string' },
      'proposal-id': { type: 'string' },
      'entity-type': { type: 'string' },
      'entity-id': { type: 'string' },
      reason: { type: 'string' },
      limit: { type: 'string' },
      module: { type: 'string' },
      kind: { type: 'string' },
      json: { type: 'string' },
      text: { type: 'string' },
      budget: { type: 'string' },
      'idempotency-key': { type: 'string' },
      'authorized-by': { type: 'string' },
      'confirm-restore': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const [domain, action, positionalId] = positionals;
  if (!domain || values.help) {
    usage(out);
    return 0;
  }

  const targetId = values.id ?? positionalId ?? null;
  const authorizer = values['authorized-by'] ?? 'CLI_USER';
  const core = createNexusCore(configOverrides);

  async function execOp(operation_type, payload = {}, extra = {}) {
    const resp = await core.executeOperationAsync({
      operation_type,
      payload,
      idempotency_key: values['idempotency-key'] ?? null,
      authorization: extra.authorization ?? null,
      source: { actor_type: 'USER', actor_id: authorizer },
    });
    if (!resp.success) {
      const firstErr = resp.errors?.[0] ?? {};
      errOut(JSON.stringify({
        error: firstErr.code ?? 'OPERATION_FAILED',
        message: firstErr.description ?? 'Operación fallida.',
        field: firstErr.field ?? null,
        remediation: firstErr.remediation ?? null,
        operation_id: resp.operation_id,
      }, null, 2));
      return 1;
    }
    print(resp.result);
    return 0;
  }

  try {
    if (domain === 'catalog') {
      print(core.operations.listOperations({
        module_id: values.module ?? null,
        kind: values.kind ?? null,
      }));
      return 0;
    }

    if (domain === 'op') {
      if (!action) {
        errOut(JSON.stringify({
          error: 'VALIDATION_ERROR',
          message: 'Debes indicar el operation_type a invocar.',
          remediation: 'Ejemplo: npm run cli -- op system.status o consulta npm run cli -- catalog.',
        }, null, 2));
        return 1;
      }
      let parsedPayload = {};
      if (values.json) {
        try {
          parsedPayload = JSON.parse(values.json);
        } catch (parseErr) {
          errOut(JSON.stringify({
            error: 'VALIDATION_ERROR',
            message: `JSON inválido en --json: ${parseErr.message}`,
            remediation: 'Pasa un objeto JSON válido entre comillas simples.',
          }, null, 2));
          return 1;
        }
      }
      const explicitAuth = values['authorized-by'] || values['confirm-restore']
        ? { approved: true, authorized_by: authorizer, scope: action }
        : null;
      return await execOp(action, parsedPayload, { authorization: explicitAuth });
    }

    if (domain === 'system') {
      if (action === 'init' || action === 'status') return await execOp('system.status');
      if (action === 'version') return await execOp('system.version');
      usage(out);
      return 2;
    }
    if (domain === 'modules') {
      if (action === 'list') return await execOp('modules.list');
      if (action === 'enable') return await execOp('modules.enable', { id: targetId });
      if (action === 'disable') return await execOp('modules.disable', { id: targetId });
      usage(out);
      return 2;
    }
    if (domain === 'memory') {
      if (action === 'create') return await execOp('memory.create', { information_type: values.type ?? 'USER_STATEMENT', content: values.content });
      if (action === 'list') return await execOp('memory.search', { information_type: values.type ?? null });
      if (action === 'history') return await execOp('memory.history', { id: targetId });
      usage(out);
      return 2;
    }
    if (domain === 'goals') {
      if (action === 'create') return await execOp('goals.create', { name: values.name });
      if (action === 'list') return await execOp('goals.list');
      usage(out);
      return 2;
    }
    if (domain === 'projects') {
      if (action === 'create') return await execOp('projects.create', { name: values.name });
      if (action === 'list') return await execOp('projects.list', { status: values.status ?? null });
      if (action === 'progress') return await execOp('projects.progress', { id: targetId });
      usage(out);
      return 2;
    }
    if (domain === 'tasks') {
      if (action === 'create') return await execOp('tasks.create', { title: values.title });
      if (action === 'list') return await execOp('tasks.list', { status: values.status ?? null });
      if (action === 'status') return await execOp('tasks.changeStatus', { id: targetId, status: values.status });
      usage(out);
      return 2;
    }
    if (domain === 'habits') {
      if (action === 'create') return await execOp('habits.create', { name: values.name, frequency: { type: values.type ?? 'DAILY' } });
      if (action === 'list') return await execOp('habits.list');
      if (action === 'occur') {
        return await execOp('habits.recordOccurrence', {
          id: targetId,
          scheduled_date: values.date ?? core.clock.todayDate(),
          status: values.status ?? 'COMPLETED',
        });
      }
      if (action === 'stats') return await execOp('habits.stats', { id: targetId });
      usage(out);
      return 2;
    }
    if (domain === 'routines') {
      if (action === 'create') return await execOp('routines.create', { name: values.name, steps: [] });
      if (action === 'list') return await execOp('routines.list');
      if (action === 'start') return await execOp('routines.startExecution', { id: targetId });
      usage(out);
      return 2;
    }
    if (domain === 'calendar') {
      if (action === 'create') return await execOp('calendar.createEvent', { title: values.title, start_at: values.start, end_at: values.end, status: values.status ?? 'PROPOSED' });
      if (action === 'list') return await execOp('calendar.listEvents', { from: values.start ?? null, to: values.end ?? null });
      if (action === 'conflicts') return await execOp('calendar.conflicts', {});
      usage(out);
      return 2;
    }
    if (domain === 'availability') {
      if (action === 'add') return await execOp('availability.createWindow', { start_at: values.start, end_at: values.end, availability_type: values.type ?? 'CONFIRMED' });
      if (action === 'free') return await execOp('availability.freeWindows', { from: values.start, to: values.end });
      usage(out);
      return 2;
    }
    if (domain === 'executions') {
      if (action === 'start') return await execOp('executions.start', { related_entity_type: values['entity-type'] ?? 'task', related_entity_id: values['entity-id'] ?? targetId });
      if (action === 'list') return await execOp('executions.list');
      usage(out);
      return 2;
    }
    if (domain === 'finance') {
      if (action === 'account') return await execOp('finance.accounts.create', { name: values.name, currency: values.currency ?? 'MXN' });
      if (action === 'income') return await execOp('finance.recordIncome', { account_id: values['account-id'], amount: Number(values.amount) });
      if (action === 'expense') return await execOp('finance.recordExpense', { account_id: values['account-id'], amount: Number(values.amount) });
      if (action === 'summary') return await execOp('finance.summary', { currency: values.currency ?? null });
      usage(out);
      return 2;
    }
    if (domain === 'inventory') {
      if (action === 'product') return await execOp('inventory.products.create', { name: values.name, unit: values.unit ?? 'unit' });
      if (action === 'stock') return await execOp(targetId ? 'inventory.stock.list' : 'inventory.products.list', targetId ? { product_id: targetId } : {});
      if (action === 'replenishment') return await execOp('inventory.replenishment.status', targetId ? { product_id: targetId } : {});
      usage(out);
      return 2;
    }
    if (domain === 'libraries') {
      if (action === 'create') return await execOp('knowledge.libraries.create', { name: values.name });
      if (action === 'list') return await execOp('knowledge.libraries.list');
      if (action === 'seed') return await execOp('knowledge.seedStarter');
      if (action === 'import') return await execOp('knowledge.import', { library_id: targetId, source_format: values.format, source_reference: values.file });
      if (action === 'export') return await execOp('knowledge.export', { library_id: targetId, target_format: values.format, destination: values.file });
      usage(out);
      return 2;
    }
    if (domain === 'doctor') {
      return await execOp('system.doctor', { referenceDate: values.date ?? core.clock.todayDate() });
    }
    if (domain === 'planning') {
      if (action === 'weekly') return await execOp('planning.generateWeekly', { week_start: values.start, week_end: values.end });
      if (action === 'daily') return await execOp('planning.agenda.daily', { date: values.date ?? core.clock.todayDate() });
      if (action === 'approve') return await execOp('planning.proposals.accept', { id: values['proposal-id'] ?? targetId, authorizedBy: authorizer });
      if (action === 'review') return await execOp('planning.dailyReview.generate', { date: values.date ?? core.clock.todayDate() });
      if (action === 'close') return await execOp('planning.dailyReview.close', { date: values.date ?? core.clock.todayDate() });
      usage(out);
      return 2;
    }
    if (domain === 'adaptation') {
      if (action === 'patterns') return await execOp('adaptation.identifyPatterns');
      if (action === 'suggestions') return await execOp('adaptation.generateSuggestions');
      if (action === 'accept') return await execOp('adaptation.respondSuggestion', { id: targetId, decision: 'ACCEPT', authorizedBy: authorizer });
      if (action === 'apply') {
        return await execOp('adaptation.applySuggestion', { id: targetId, authorizedBy: authorizer }, {
          authorization: { approved: true, authorized_by: authorizer, scope: 'adaptation.applySuggestion' },
        });
      }
      usage(out);
      return 2;
    }
    if (domain === 'spaces') {
      if (action === 'snapshot') return await execOp('spaces.snapshot', { referenceDate: values.date ?? core.clock.todayDate() });
      if (action === 'unpaid') return await execOp('spaces.commitments.unpaid', { referenceDate: values.date ?? core.clock.todayDate() });
      if (action === 'pay') {
        return await execOp('spaces.commitments.pay', {
          commitmentName: values.name,
          amount: Number(values.amount),
          paidAt: values.date ?? core.clock.nowIso(),
        });
      }
      usage(out);
      return 2;
    }
    if (domain === 'saturday') {
      if (action === 'prepare') {
        return await execOp('saturday.review.prepare', {
          nextWeekStartDate: values.start ?? core.clock.todayDate(),
          weeklyGroceryBudget: values.budget !== undefined ? Number(values.budget) : 0,
          referenceDate: values.date ?? core.clock.todayDate(),
        });
      }
      if (action === 'baselines') return await execOp('spaces.baselines.list');
      if (action === 'baseline') return await execOp('spaces.baselines.get', { id: targetId });
      usage(out);
      return 2;
    }
    if (domain === 'dashboard') {
      if (action === 'habits') {
        return await execOp('dashboard.habitsMood', {
          from: values.start ?? null,
          to: values.end ?? null,
        });
      }
      if (action === 'projects') {
        return await execOp('dashboard.projectsGoals', {
          referenceDate: values.date ?? core.clock.todayDate(),
        });
      }
      if (action === 'calendar') {
        const refDate = values.date ?? core.clock.todayDate();
        const [year, month] = refDate.split('-').map(Number);
        return await execOp('dashboard.masterCalendar', { year, month });
      }
      usage(out);
      return 2;
    }
    if (domain === 'copilot') {
      if (action === 'draft') return await execOp('copilot.proposals.draft', { text: values.text ?? '' });
      if (action === 'chat') {
        return await execOp('copilot.chat.send', {
          conversationId: targetId,
          message: values.text ?? '',
          referenceDate: values.date ?? core.clock.todayDate(),
        });
      }
      usage(out);
      return 2;
    }
    if (domain === 'audit') {
      return await execOp('audit.history', { limit: Number(values.limit ?? 20) });
    }
    if (domain === 'health') {
      return await execOp('persistence.health');
    }
    if (domain === 'backup') {
      if (action === 'create') return await execOp('backup.create', { reason: values.reason ?? 'cli-manual' });
      if (action === 'list') return await execOp('backup.list');
      if (action === 'verify') {
        if (!targetId) {
          errOut(JSON.stringify({
            error: 'VALIDATION_ERROR',
            message: 'Debes indicar el identificador del respaldo a verificar.',
            remediation: 'Ejecuta `npm run cli -- backup verify <backup_id>` o `npm run cli -- backup verify --id <backup_id>`. Usa `backup list` para ver IDs disponibles.',
          }, null, 2));
          return 1;
        }
        return await execOp('backup.verify', { id: targetId });
      }
      usage(out);
      return 2;
    }
    if (domain === 'restore') {
      if (action === 'inspect') return await execOp('restore.inspect', { id: targetId });
      if (action === 'validate') return await execOp('restore.validate', { id: targetId });
      if (action === 'execute') {
        const auth = values['confirm-restore']
          ? { approved: true, authorized_by: authorizer, scope: 'restore.execute' }
          : null;
        return await execOp('restore.execute', { id: targetId }, { authorization: auth });
      }
      usage(out);
      return 2;
    }

    usage(out);
    return 2;
  } finally {
    core.shutdown();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then(code => { process.exitCode = code; }).catch(err => {
    console.error(JSON.stringify({ error: err.code ?? 'ERROR', message: err.message, remediation: err.remediation ?? null }, null, 2));
    process.exitCode = 1;
  });
}
