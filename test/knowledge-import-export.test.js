import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createNexusCore } from '../src/core/nexus-core.js';
import { createXlsxAdapter, normalizeExcelCellValue, xlsxAdapter } from '../src/integration/importers/xlsx-adapter.js';

function makeTempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nl-b04-test-'));
  return {
    root,
    dataDir: path.join(root, 'data'),
    backupDir: path.join(root, 'backups'),
    workDir: path.join(root, 'work'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('B04.1 — Desacoplamiento de Knowledge respecto a Integration e independencia total frente a Memoria Personal', async () => {
  const srcText = fs.readFileSync(
    new URL('../src/application/knowledge/knowledge-services.js', import.meta.url),
    'utf8'
  );
  assert.equal(srcText.includes('/integration/'), false, 'application/knowledge no debe importar de integration/');

  const dirs = makeTempDirs();
  fs.mkdirSync(dirs.workDir, { recursive: true });
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });

  try {
    const lib = core.libraryService.createLibrary({ name: 'Manuales Técnicos', category: 'ingenieria' });

    // Markdown import/export
    const mdPath = path.join(dirs.workDir, 'guia.md');
    fs.writeFileSync(mdPath, '# Arquitectura Hexagonal\n\nSeparación estricta de puertos y adaptadores.\n');
    const mdImport = await core.executeOperationAsync({
      operation_type: 'knowledge.import',
      payload: { library_id: lib.id, source_format: 'MARKDOWN', source_reference: mdPath },
    });
    assert.equal(mdImport.success, true);
    assert.equal(mdImport.result.status, 'COMPLETED');

    // CSV import PARTIAL (una fila válida + una fila sin título -> PARTIAL, nunca COMPLETED)
    const csvPath = path.join(dirs.workDir, 'catalogo.csv');
    fs.writeFileSync(csvPath, 'title,content,area\nSQLite WAL,Modo concurrente local,persistencia\n,Fila invalida sin titulo,error\n');
    const csvImport = await core.executeOperationAsync({
      operation_type: 'knowledge.import',
      payload: { library_id: lib.id, source_format: 'CSV', source_reference: csvPath },
    });
    assert.equal(csvImport.result.status, 'PARTIAL');
    assert.equal(csvImport.result.result_summary.imported_count, 1);
    assert.equal(csvImport.result.errors.length, 1);

    // JSON export e import
    const jsonOut = path.join(dirs.workDir, 'export.json');
    const jsonExport = await core.executeOperationAsync({
      operation_type: 'knowledge.export',
      payload: { library_id: lib.id, target_format: 'JSON', destination: jsonOut },
    });
    assert.equal(jsonExport.result.status, 'COMPLETED');
    assert.equal(fs.existsSync(jsonOut), true);

    // Independencia absoluta: memory_records sigue vacío
    assert.equal(core.memoryService.searchMemory().length, 0);
    assert.equal(core.knowledgeDocumentService.searchDocuments({ library_id: lib.id }).length, 2);
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});

test('B04.2 — Normalización completa de celdas complejas ExcelJS y flujo multi-hoja del adaptador XLSX', async () => {
  // 1. Pruebas exhaustivas de normalizeExcelCellValue (sin producir jamás [object Object])
  assert.equal(normalizeExcelCellValue(null), '');
  assert.equal(normalizeExcelCellValue(42.5), 42.5);
  assert.equal(normalizeExcelCellValue(true), true);
  assert.equal(normalizeExcelCellValue(new Date('2026-11-24T12:00:00.000Z')), '2026-11-24T12:00:00.000Z');
  assert.equal(normalizeExcelCellValue({ formula: 'SUM(A1:A3)', result: 150 }), 150);
  assert.equal(normalizeExcelCellValue({ sharedFormula: 'B2', result: { error: '#DIV/0!' } }), '#DIV/0!');
  assert.equal(
    normalizeExcelCellValue({ richText: [{ text: 'Nota ' }, { font: { bold: true }, text: 'importante' }] }),
    'Nota importante'
  );
  assert.equal(
    normalizeExcelCellValue({ text: 'Documentación local', hyperlink: 'https://localhost/doc' }),
    'Documentación local'
  );

  // 2. Verificación del contrato multi-hoja de createXlsxAdapter con doble de Workbook compatible con API ExcelJS
  const writtenSheets = [];
  class FakeWorkbook {
    constructor() {
      this._sheets = [
        {
          name: 'Finanzas',
          rows: [
            [null, 'title', 'content', 'monto', 'fecha'],
            [null, { richText: [{ text: 'Presupuesto ' }, { text: 'Anual' }] }, 'Detalle base', { formula: '100+50', result: 150 }, new Date('2026-11-01T00:00:00.000Z')],
            [null, '', 'Fila sin título', 0, null],
          ],
        },
        {
          name: 'Referencias',
          rows: [
            [null, 'nombre', 'descripcion', 'enlace'],
            [null, 'Guía SQLite', 'Referencia oficial', { text: 'SQLite Docs', hyperlink: 'file:///local/sqlite' }],
          ],
        },
      ];
      this.xlsx = {
        readFile: async () => {},
        writeFile: async dest => { fs.writeFileSync(dest, 'FAKE_XLSX_CONTAINER'); },
      };
    }
    eachSheet(cb) {
      for (const s of this._sheets) {
        cb({
          name: s.name,
          eachRow(_opts, rowCb) {
            s.rows.forEach((vals, idx) => rowCb({ values: vals }, idx + 1));
          },
        });
      }
    }
    addWorksheet(name) {
      const sheetRecord = { name, columns: [], rows: [] };
      writtenSheets.push(sheetRecord);
      return {
        set columns(cols) { sheetRecord.columns = cols; },
        get columns() { return sheetRecord.columns; },
        addRow(r) { sheetRecord.rows.push(r); },
      };
    }
  }

  const dirs = makeTempDirs();
  fs.mkdirSync(dirs.workDir, { recursive: true });
  try {
    const adapterWithMock = createXlsxAdapter({ loadExcelJs: async () => ({ Workbook: FakeWorkbook }) });
    const parsed = await adapterWithMock.importFile(path.join(dirs.workDir, 'libro.xlsx'));
    assert.equal(parsed.documents.length, 2);
    assert.equal(parsed.errors.length, 1);
    assert.equal(parsed.documents[0].title, 'Presupuesto Anual');
    assert.equal(parsed.documents[0].metadata.columns.monto, 150);
    assert.equal(parsed.documents[0].metadata.columns.fecha, '2026-11-01T00:00:00.000Z');
    assert.equal(parsed.documents[1].metadata.sheet, 'Referencias');
    assert.equal(parsed.documents[1].metadata.columns.enlace, 'SQLite Docs');

    const outDest = path.join(dirs.workDir, 'out.xlsx');
    await adapterWithMock.exportDocuments(
      parsed.documents.map((d, i) => ({ id: `doc_${i}`, version: 1, ...d })),
      outDest
    );
    assert.equal(writtenSheets.length, 2, 'Preserva hojas separadas al exportar');
    assert.ok(writtenSheets[0].columns.some(c => c.header === 'monto'), 'Incluye columnas dinámicas de metadata.columns');
  } finally {
    dirs.cleanup();
  }
});

test('B04.3 (DP-01) — Integración XLSX real si exceljs está instalado, o degradación explícita transparente sin afectar otros formatos', async () => {
  const dirs = makeTempDirs();
  fs.mkdirSync(dirs.workDir, { recursive: true });
  const core = createNexusCore({ dataDir: dirs.dataDir, backupDir: dirs.backupDir });

  try {
    const lib = core.libraryService.createLibrary({ name: 'Hojas XLSX' });
    const hasExcelJs = await xlsxAdapter.isAvailable();

    if (hasExcelJs) {
      const doc = core.knowledgeDocumentService.createDocument({
        library_id: lib.id,
        title: 'Registro Real XLSX',
        document_type: 'XLSX_ROW',
        content: 'Contenido verificado con ExcelJS real',
        metadata: { sheet: 'HojaReal', columns: { metrica: 99 } },
      });
      assert.ok(doc.id);

      const xlsxDest = path.join(dirs.workDir, 'real_export.xlsx');
      const expRes = await core.executeOperationAsync({
        operation_type: 'knowledge.export',
        payload: { library_id: lib.id, target_format: 'XLSX', destination: xlsxDest },
      });
      assert.equal(expRes.result.status, 'COMPLETED');

      const lib2 = core.libraryService.createLibrary({ name: 'Hojas Reimportadas' });
      const impRes = await core.executeOperationAsync({
        operation_type: 'knowledge.import',
        payload: { library_id: lib2.id, source_format: 'XLSX', source_reference: xlsxDest },
      });
      assert.equal(impRes.result.status, 'COMPLETED');
      assert.equal(impRes.result.result_summary.imported_count, 1);
    } else {
      // Sin exceljs en node_modules: reporta FAILED explícito con mensaje claro y nunca finge éxito vía CSV
      const dummyXlsx = path.join(dirs.workDir, 'pendiente.xlsx');
      fs.writeFileSync(dummyXlsx, 'placeholder');
      const impRes = await core.executeOperationAsync({
        operation_type: 'knowledge.import',
        payload: { library_id: lib.id, source_format: 'XLSX', source_reference: dummyXlsx },
      });
      assert.equal(impRes.success, true);
      assert.equal(impRes.result.status, 'FAILED');
      assert.ok(impRes.result.errors[0].includes('exceljs'));
    }
  } finally {
    core.shutdown();
    dirs.cleanup();
  }
});
