import { createNexusCore } from './core/nexus-core.js';
import { createCoreHttpServer } from './interfaces/http/http-server.js';

const core = createNexusCore();
const server = createCoreHttpServer(core);

server.listen(core.config.port, core.config.host, () => {
  const version = core.systemService.getVersion();
  console.log(`Nexus Lunar ${version.version} activo en http://${core.config.host}:${core.config.port}`);
  console.log(`Base de datos: ${core.persistenceService.getDbPath()} (esquema v${version.schema_version})`);
  console.log(`Respaldos: ${core.config.backupDir}`);
  console.log('Modo: Local / Offline / Sin IA real integrada. Pulsa Ctrl+C para detener.');
});

function shutdown() {
  server.close(() => {
    core.shutdown();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
