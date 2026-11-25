import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, NexusError, normalizeError } from '../../shared/errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const POST_MUTATION_ACTIONS = new Set(['CREATE', 'EXECUTE', 'APPROVE', 'CORRECT', 'EXPORT', 'RESTORE']);
const PUT_PATCH_MUTATION_ACTIONS = new Set(['UPDATE', 'CORRECT', 'APPROVE', 'ARCHIVE']);
const DELETE_MUTATION_ACTIONS = new Set(['DELETE', 'ARCHIVE']);

const SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
});

function extractHostName(hostHeader = '') {
  const trimmed = String(hostHeader).trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed.startsWith('[')) {
    const endIdx = trimmed.indexOf(']');
    return endIdx !== -1 ? trimmed.slice(0, endIdx + 1) : trimmed;
  }
  return trimmed.split(':')[0];
}

export function assertLocalHttpSecurity(req, { allowPublicBind = false } = {}) {
  if (allowPublicBind) return;

  const hostHeader = req.headers.host;
  if (hostHeader) {
    const hostname = extractHostName(hostHeader);
    if (!LOOPBACK_HOSTS.has(hostname)) {
      throw new NexusError(
        ERROR_CODES.PERMISSION_DENIED,
        `SEC-003: Solicitud bloqueada por cabecera Host no local (${hostHeader}).`,
        { statusCode: 403, remediation: 'Accede exclusivamente a través de 127.0.0.1 o localhost.' }
      );
    }
  }

  if (MUTATING_METHODS.has(req.method)) {
    const secFetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
    if (secFetchSite === 'cross-site') {
      throw new NexusError(
        ERROR_CODES.PERMISSION_DENIED,
        'SEC-003: Petición mutadora cross-site bloqueada.',
        { statusCode: 403 }
      );
    }
    const origin = req.headers.origin;
    if (origin) {
      let parsedOrigin;
      try {
        parsedOrigin = new URL(origin);
      } catch {
        throw new NexusError(ERROR_CODES.PERMISSION_DENIED, 'Cabecera Origin inválida.', { statusCode: 403 });
      }
      if (!LOOPBACK_HOSTS.has(parsedOrigin.hostname.toLowerCase())) {
        throw new NexusError(
          ERROR_CODES.PERMISSION_DENIED,
          `SEC-003: Origen externo no autorizado (${origin}) en operación mutadora.`,
          { statusCode: 403 }
        );
      }
    }
  }
}

/**
 * Validación centralizada método HTTP <-> clasificación de operación en OperationRegistry (NL-SEC-HTTP-001).
 * Garantiza que ninguna petición GET pueda invocar una operación MUTATION y que cada método HTTP
 * solo ejecute operaciones semánticamente compatibles antes de alcanzar el Dispatcher o los servicios.
 */
export function assertHttpMethodOperationCompatibility(httpMethod, spec, { rpcEnvelope = false } = {}) {
  const method = String(httpMethod ?? '').toUpperCase();
  if (!spec) {
    throw new NexusError(ERROR_CODES.NOT_FOUND, 'Operación no registrada en el catálogo.', {
      field: 'operation_type',
      statusCode: 404,
      remediation: 'Consulta GET /api/operations/catalog para conocer las operaciones disponibles.',
    });
  }

  if (method === 'GET' || method === 'HEAD') {
    if (spec.kind !== 'QUERY' || spec.action !== 'READ') {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `NL-SEC-HTTP-001: El método HTTP ${method} solo permite operaciones QUERY de lectura; '${spec.operation_type}' es ${spec.kind} (${spec.action}).`,
        {
          statusCode: 405,
          details: { http_method: method, operation_type: spec.operation_type, kind: spec.kind, action: spec.action },
          remediation: 'Utiliza POST, PATCH, PUT o DELETE según corresponda para ejecutar mutaciones.',
        }
      );
    }
    return;
  }

  if (method === 'POST') {
    if (rpcEnvelope && spec.kind === 'QUERY') {
      return;
    }
    if (spec.kind !== 'MUTATION' || !POST_MUTATION_ACTIONS.has(spec.action)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `NL-SEC-HTTP-001: El método HTTP POST en rutas REST requiere una operación MUTATION de creación o comando; '${spec.operation_type}' es ${spec.kind} (${spec.action}).`,
        {
          statusCode: 405,
          details: { http_method: method, operation_type: spec.operation_type, kind: spec.kind, action: spec.action },
          remediation: spec.kind === 'QUERY'
            ? 'Utiliza GET para operaciones de consulta.'
            : 'Utiliza el método HTTP compatible con la acción de la operación.',
        }
      );
    }
    return;
  }

  if (method === 'PUT' || method === 'PATCH') {
    if (spec.kind !== 'MUTATION' || !PUT_PATCH_MUTATION_ACTIONS.has(spec.action)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `NL-SEC-HTTP-001: El método HTTP ${method} requiere una operación MUTATION de actualización compatible; '${spec.operation_type}' es ${spec.kind} (${spec.action}).`,
        {
          statusCode: 405,
          details: { http_method: method, operation_type: spec.operation_type, kind: spec.kind, action: spec.action },
          remediation: 'Utiliza GET para consultas o POST/DELETE según la acción registrada.',
        }
      );
    }
    return;
  }

  if (method === 'DELETE') {
    if (spec.kind !== 'MUTATION' || !DELETE_MUTATION_ACTIONS.has(spec.action)) {
      throw new NexusError(
        ERROR_CODES.VALIDATION_ERROR,
        `NL-SEC-HTTP-001: El método HTTP DELETE requiere una operación MUTATION de eliminación o baja; '${spec.operation_type}' es ${spec.kind} (${spec.action}).`,
        {
          statusCode: 405,
          details: { http_method: method, operation_type: spec.operation_type, kind: spec.kind, action: spec.action },
          remediation: 'Utiliza GET para consultas o POST/PATCH para creación y actualización.',
        }
      );
    }
    return;
  }

  throw new NexusError(
    ERROR_CODES.VALIDATION_ERROR,
    `Método HTTP no soportado: ${method || 'UNKNOWN'}.`,
    { statusCode: 405 }
  );
}

const HTTP_REST_ROUTE_DEFINITIONS = Object.freeze([
  { method: 'GET', path: '/api/system/status', status: 200, operation_type: 'system.status' },
  {
    method: 'GET',
    path: '/api/system/doctor',
    status: 200,
    operation_type: 'system.doctor',
    buildPayload: ({ url, core }) => ({ referenceDate: url.searchParams.get('referenceDate') ?? core.clock.todayDate() }),
  },
  { method: 'GET', path: '/api/health/storage', status: 200, operation_type: 'persistence.health' },
  { method: 'GET', path: '/api/modules', status: 200, operation_type: 'modules.list' },

  // Memoria
  {
    method: 'GET',
    path: '/api/memory',
    status: 200,
    operation_type: 'memory.search',
    buildPayload: ({ url }) => ({ information_type: url.searchParams.get('type'), q: url.searchParams.get('q') }),
  },
  { method: 'POST', path: '/api/memory', status: 201, operation_type: 'memory.create', readBody: true },

  // Gestión personal
  { method: 'GET', path: '/api/goals', status: 200, operation_type: 'goals.list' },
  { method: 'POST', path: '/api/goals', status: 201, operation_type: 'goals.create', readBody: true },
  {
    method: 'GET',
    path: '/api/projects',
    status: 200,
    operation_type: 'projects.list',
    buildPayload: ({ url }) => ({ status: url.searchParams.get('status') }),
  },
  { method: 'POST', path: '/api/projects', status: 201, operation_type: 'projects.create', readBody: true },
  {
    method: 'GET',
    path: '/api/tasks',
    status: 200,
    operation_type: 'tasks.list',
    buildPayload: ({ url }) => ({ status: url.searchParams.get('status') }),
  },
  { method: 'POST', path: '/api/tasks', status: 201, operation_type: 'tasks.create', readBody: true },
  {
    method: 'PATCH',
    path: '/api/tasks/:id/status',
    regex: /^\/api\/tasks\/([^/]+)\/status$/,
    status: 200,
    operation_type: 'tasks.changeStatus',
    readBody: true,
    buildPayload: ({ match, body }) => ({ id: decodeURIComponent(match[1]), status: body.status }),
  },

  // Tiempo y disponibilidad
  {
    method: 'GET',
    path: '/api/calendar/events',
    status: 200,
    operation_type: 'calendar.listEvents',
    buildPayload: ({ url }) => ({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }),
  },
  { method: 'POST', path: '/api/calendar/events', status: 201, operation_type: 'calendar.createEvent', readBody: true },
  {
    method: 'GET',
    path: '/api/availability',
    status: 200,
    operation_type: 'availability.list',
    buildPayload: ({ url }) => ({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }),
  },
  { method: 'POST', path: '/api/availability', status: 201, operation_type: 'availability.createWindow', readBody: true },

  // Hábitos y rutinas
  { method: 'GET', path: '/api/habits', status: 200, operation_type: 'habits.list' },
  { method: 'POST', path: '/api/habits', status: 201, operation_type: 'habits.create', readBody: true },
  {
    method: 'POST',
    path: '/api/habits/:id/occurrences',
    regex: /^\/api\/habits\/([^/]+)\/occurrences$/,
    status: 200,
    operation_type: 'habits.recordOccurrence',
    readBody: true,
    buildPayload: ({ match, body }) => ({ ...body, id: decodeURIComponent(match[1]) }),
  },
  { method: 'GET', path: '/api/routines', status: 200, operation_type: 'routines.list' },
  { method: 'POST', path: '/api/routines', status: 201, operation_type: 'routines.create', readBody: true },

  // Finanzas e inventario
  { method: 'GET', path: '/api/finance/summary', status: 200, operation_type: 'finance.summary' },
  { method: 'GET', path: '/api/finance/accounts', status: 200, operation_type: 'finance.accounts.list' },
  { method: 'POST', path: '/api/finance/accounts', status: 201, operation_type: 'finance.accounts.create', readBody: true },
  { method: 'GET', path: '/api/inventory/products', status: 200, operation_type: 'inventory.products.list' },
  { method: 'POST', path: '/api/inventory/products', status: 201, operation_type: 'inventory.products.create', readBody: true },

  // Bibliotecas
  { method: 'GET', path: '/api/libraries', status: 200, operation_type: 'knowledge.libraries.list' },
  { method: 'POST', path: '/api/libraries', status: 201, operation_type: 'knowledge.libraries.create', readBody: true },
  { method: 'POST', path: '/api/knowledge/seed-starter', status: 201, operation_type: 'knowledge.seedStarter' },

  // Planificación y Adaptación
  { method: 'GET', path: '/api/planning/plans', status: 200, operation_type: 'planning.plans.list' },
  { method: 'POST', path: '/api/planning/weekly', status: 201, operation_type: 'planning.generateWeekly', readBody: true },
  { method: 'POST', path: '/api/planning/daily', status: 201, operation_type: 'planning.agenda.daily', readBody: true },
  {
    method: 'GET',
    path: '/api/planning/review',
    status: 200,
    operation_type: 'planning.dailyReview.get',
    buildPayload: ({ url, core }) => ({ date: url.searchParams.get('date') ?? core.clock.todayDate() }),
  },
  {
    method: 'POST',
    path: '/api/planning/review',
    status: 201,
    operation_type: 'planning.dailyReview.generate',
    readBody: true,
    buildPayload: ({ url, body, core }) => ({
      date: body?.date ?? url.searchParams.get('date') ?? core.clock.todayDate(),
    }),
  },
  { method: 'GET', path: '/api/adaptation/suggestions', status: 200, operation_type: 'adaptation.suggestions.list' },

  // Respaldos
  { method: 'GET', path: '/api/backups', status: 200, operation_type: 'backup.list' },
  {
    method: 'POST',
    path: '/api/backups',
    status: 201,
    operation_type: 'backup.create',
    readBody: true,
    buildPayload: ({ body }) => ({ reason: body?.reason ?? 'web-manual' }),
  },

  // Espacios Especializados, Revisión del Sábado y Copiloto
  {
    method: 'GET',
    path: '/api/spaces/catalog',
    status: 200,
    operation_type: 'spaces.catalog',
  },
  {
    method: 'GET',
    path: '/api/spaces/snapshot',
    status: 200,
    operation_type: 'spaces.snapshot',
    buildPayload: ({ url, core }) => ({ referenceDate: url.searchParams.get('referenceDate') ?? core.clock.todayDate() }),
  },
  { method: 'POST', path: '/api/spaces/profile', status: 201, operation_type: 'spaces.profile.save', readBody: true },
  { method: 'PATCH', path: '/api/spaces/biometrics', status: 200, operation_type: 'spaces.biometrics.update', readBody: true },
  { method: 'POST', path: '/api/spaces/clinical', status: 201, operation_type: 'spaces.clinical.record', readBody: true },
  { method: 'PUT', path: '/api/spaces/employments', status: 200, operation_type: 'spaces.employments.update', readBody: true },
  { method: 'PUT', path: '/api/spaces/commitments', status: 200, operation_type: 'spaces.commitments.update', readBody: true },
  { method: 'POST', path: '/api/spaces/commitments/payments', status: 201, operation_type: 'spaces.commitments.pay', readBody: true },
  {
    method: 'GET',
    path: '/api/spaces/commitments/unpaid',
    status: 200,
    operation_type: 'spaces.commitments.unpaid',
    buildPayload: ({ url, core }) => ({ referenceDate: url.searchParams.get('referenceDate') ?? core.clock.todayDate() }),
  },
  { method: 'POST', path: '/api/planning/saturday/prepare', status: 200, operation_type: 'saturday.review.prepare', readBody: true },
  { method: 'POST', path: '/api/planning/saturday/approve', status: 201, operation_type: 'saturday.baseline.approve', readBody: true },
  { method: 'GET', path: '/api/planning/baselines', status: 200, operation_type: 'spaces.baselines.list' },
  {
    method: 'GET',
    path: '/api/planning/baselines/:id',
    regex: /^\/api\/planning\/baselines\/([^/]+)$/,
    status: 200,
    operation_type: 'spaces.baselines.get',
    buildPayload: ({ match }) => ({ id: decodeURIComponent(match[1]) }),
  },
  {
    method: 'POST',
    path: '/api/planning/baselines/:id/executions',
    regex: /^\/api\/planning\/baselines\/([^/]+)\/executions$/,
    status: 201,
    operation_type: 'week.execution.record',
    readBody: true,
    buildPayload: ({ match, body }) => ({ ...body, baselineId: decodeURIComponent(match[1]) }),
  },
  {
    method: 'POST',
    path: '/api/planning/baselines/:id/revisions',
    regex: /^\/api\/planning\/baselines\/([^/]+)\/revisions$/,
    status: 201,
    operation_type: 'week.revision.record',
    readBody: true,
    buildPayload: ({ match, body }) => ({ ...body, baselineId: decodeURIComponent(match[1]) }),
  },
  { method: 'POST', path: '/api/copilot/proposals', status: 200, operation_type: 'copilot.proposals.draft', readBody: true },
]);

export function getHttpRouteDefinitions() {
  return HTTP_REST_ROUTE_DEFINITIONS.map(({ method, path: routePath, status, operation_type }) => ({
    method,
    path: routePath,
    status,
    operation_type,
  }));
}

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../public');
const publicFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
};

const ASSET_MIME_BY_EXT = Object.freeze({
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
});

function resolveSafeStaticFile(pathname) {
  if (typeof pathname !== 'string' || pathname.includes('\\') || pathname.includes('\0') || pathname.includes('..')) {
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ruta de archivo estático malformada.', { statusCode: 400 });
  }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.includes('..')) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ruta de archivo estático inválida.', { statusCode: 400 });
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((seg) => seg.startsWith('..'))) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ruta de archivo estático inválida.', { statusCode: 400 });
  }

  const ext = path.extname(decoded).toLowerCase();
  let contentType = null;
  if (decoded.startsWith('/js/') && ext === '.js') {
    contentType = 'text/javascript; charset=utf-8';
  } else if (decoded.startsWith('/css/') && ext === '.css') {
    contentType = 'text/css; charset=utf-8';
  } else if (decoded.startsWith('/assets/') && ASSET_MIME_BY_EXT[ext]) {
    contentType = ASSET_MIME_BY_EXT[ext];
  } else {
    return null;
  }

  const targetPath = path.resolve(publicDir, `.${decoded}`);
  if (!targetPath.startsWith(publicDir + path.sep)) {
    throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'Ruta de archivo estático fuera de public/.', { statusCode: 400 });
  }
  return { targetPath, contentType };
}

async function servePublic(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const entry = publicFiles[pathname];
  if (entry) {
    const content = await readFile(path.join(publicDir, entry[0]));
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': entry[1],
      'cache-control': 'no-cache',
    });
    res.end(content);
    return true;
  }

  const resolved = resolveSafeStaticFile(pathname);
  if (!resolved) return false;
  try {
    const content = await readFile(resolved.targetPath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': resolved.contentType,
      'cache-control': 'no-cache',
    });
    res.end(content);
    return true;
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'EISDIR') {
      return false;
    }
    throw err;
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1048576) {
      const e = new Error('Cuerpo mayor a 1 MB.');
      e.statusCode = 413;
      throw e;
    }
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const e = new Error('JSON inválido.');
    e.statusCode = 400;
    throw e;
  }
}

export function createCoreHttpServer(core) {
  // Verificación estructural al construir el servidor: impide registrar rutas REST con métodos incompatibles
  for (const route of HTTP_REST_ROUTE_DEFINITIONS) {
    const spec = core.operations.getOperationSpec(route.operation_type);
    assertHttpMethodOperationCompatibility(route.method, spec, { rpcEnvelope: false });
  }

  async function executeHttpOperation(httpMethod, rawReq, { rpcEnvelope = false } = {}) {
    if (!rawReq?.operation_type || typeof rawReq.operation_type !== 'string') {
      throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'operation_type es obligatorio.', {
        field: 'operation_type',
        statusCode: 400,
      });
    }
    const spec = core.operations.getOperationSpec(rawReq.operation_type);
    // Guardia centralizada obligatoria ANTES de invocar el Dispatcher o cualquier servicio
    assertHttpMethodOperationCompatibility(httpMethod, spec, { rpcEnvelope });
    return core.executeOperationAsync(rawReq);
  }

  async function dispatchRest(req, res, successStatus, operation_type, payload = {}, extra = {}) {
    const idempotencyHeader = req.headers['x-idempotency-key'] ?? null;
    const resp = await executeHttpOperation(
      req.method,
      {
        operation_type,
        payload,
        idempotency_key: extra.idempotency_key ?? idempotencyHeader,
        authorization: extra.authorization ?? payload?.authorization ?? null,
        source: { actor_type: 'USER', actor_id: 'http-local' },
      },
      { rpcEnvelope: false }
    );
    if (!resp.success) {
      const status = resp.metadata?.status_code ?? 400;
      return sendJson(res, status, {
        error: resp.errors[0],
        operation_id: resp.operation_id,
        metadata: resp.metadata,
      });
    }
    return sendJson(res, successStatus, {
      data: resp.result,
      operation_id: resp.operation_id,
      warnings: resp.warnings,
      metadata: resp.metadata,
    });
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const m = req.method;

    try {
      // 1. Controles de seguridad locales y CSRF antes de leer cuerpos o despachar operaciones
      assertLocalHttpSecurity(req, { allowPublicBind: core.config?.allowPublicBind });
      if (await servePublic(req, res, p)) return;

      // 2. Catálogo y frontera universal de operaciones (protegida también por compatibilidad de método HTTP)
      if (m === 'GET' && p === '/api/operations/catalog') {
        const list = core.operations.listOperations({
          module_id: url.searchParams.get('module_id'),
          kind: url.searchParams.get('kind'),
        });
        return sendJson(res, 200, { data: list });
      }
      if (p === '/api/operations') {
        if (m === 'GET') {
          let queryPayload = {};
          const rawPayloadParam = url.searchParams.get('payload');
          if (rawPayloadParam) {
            try {
              queryPayload = JSON.parse(rawPayloadParam);
            } catch {
              throw new NexusError(ERROR_CODES.VALIDATION_ERROR, 'JSON inválido en parámetro payload.', { statusCode: 400 });
            }
          }
          const resp = await executeHttpOperation(
            m,
            {
              operation_type: url.searchParams.get('operation_type'),
              payload: queryPayload,
              source: { actor_type: 'USER', actor_id: 'http-local' },
            },
            { rpcEnvelope: false }
          );
          const status = resp.success ? 200 : (resp.metadata?.status_code ?? 400);
          return sendJson(res, status, resp);
        }

        const rawReq = await readJsonBody(req);
        const resp = await executeHttpOperation(
          m,
          {
            ...rawReq,
            source: rawReq.source ?? { actor_type: 'USER', actor_id: 'http-local' },
            idempotency_key: rawReq.idempotency_key ?? req.headers['x-idempotency-key'] ?? null,
          },
          { rpcEnvelope: m === 'POST' }
        );
        const status = resp.success ? 200 : (resp.metadata?.status_code ?? 400);
        return sendJson(res, status, resp);
      }

      // 3. Salud y estado compuesto de IA preparada (ambos exclusivamente QUERY sobre GET)
      if (m === 'GET' && p === '/health') {
        const stResp = await executeHttpOperation('GET', { operation_type: 'system.status' });
        const st = stResp.result;
        return sendJson(res, 200, {
          status: 'ok',
          application: st.application,
          version: st.version,
          system_status: st.status,
          schema_version: st.storage.schema_version,
          timezone: core.config.timezone,
          local_only: true,
          ai_integrated: false,
          ollama_configured: Boolean(core.config?.ollamaEndpoint),
          ollama_model: core.config?.ollamaEndpoint ? core.config.ollamaModel : null,
          timestamp: core.clock.nowIso(),
        });
      }

      if (m === 'GET' && p === '/api/ai/status') {
        const [aiResp, cioResp] = await Promise.all([
          executeHttpOperation('GET', { operation_type: 'ai.status' }),
          executeHttpOperation('GET', { operation_type: 'cio.contract' }),
        ]);
        if (!aiResp.success) return sendJson(res, aiResp.metadata?.status_code ?? 503, { error: aiResp.errors[0] });
        return sendJson(res, 200, {
          data: {
            interaction: aiResp.result,
            secret_store: core.secretStore.getStatus(),
            cio: cioResp.result,
          },
        });
      }

      // 4. Despacho de rutas REST declarativas (todas pre-validadas y re-validadas en ejecución)
      for (const route of HTTP_REST_ROUTE_DEFINITIONS) {
        if (route.method !== m) continue;
        let match = null;
        if (route.regex) {
          match = p.match(route.regex);
          if (!match) continue;
        } else if (route.path !== p) {
          continue;
        }

        const body = route.readBody ? await readJsonBody(req) : undefined;
        const payload = route.buildPayload ? route.buildPayload({ req, url, match, body, core }) : (body ?? {});
        return dispatchRest(req, res, route.status, route.operation_type, payload);
      }

      return sendJson(res, 404, { error: { code: 'NOT_FOUND', description: 'Ruta no encontrada.' } });
    } catch (err) {
      const normalized = normalizeError(err);
      return sendJson(res, normalized.statusCode, { error: normalized.toJSON() });
    }
  });
}
