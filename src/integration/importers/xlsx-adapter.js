import fs from 'node:fs';
import path from 'node:path';
import { ERROR_CODES, NexusError } from '../../shared/errors.js';

/**
 * Normaliza los tipos complejos de celda devueltos por ExcelJS:
 * - Date -> ISO-8601 UTC
 * - { formula, result } / { sharedFormula, result } -> resultado evaluado
 * - { richText: [{ text }] } -> texto concatenado
 * - { text, hyperlink } -> texto visible o hipervínculo
 * - { error } -> código de error Excel explícito (ej. '#DIV/0!')
 */
export function normalizeExcelCellValue(raw) {
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? '' : raw.toISOString();
  }
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'object') {
    if ('formula' in raw || 'sharedFormula' in raw) {
      return normalizeExcelCellValue(raw.result);
    }
    if (Array.isArray(raw.richText)) {
      return raw.richText.map(part => String(part?.text ?? '')).join('');
    }
    if ('hyperlink' in raw) {
      return raw.text !== undefined && raw.text !== null ? String(raw.text) : String(raw.hyperlink ?? '');
    }
    if ('error' in raw && raw.error) {
      return String(raw.error);
    }
    if ('text' in raw && raw.text !== undefined) {
      return String(raw.text);
    }
    return JSON.stringify(raw);
  }
  return String(raw);
}

async function defaultLoadExcelJs() {
  try {
    const mod = await import('exceljs');
    return mod.default ?? mod;
  } catch {
    throw new NexusError(
      ERROR_CODES.SERVICE_UNAVAILABLE,
      "El soporte real XLSX requiere la dependencia local 'exceljs', que no está instalada en este entorno.",
      {
        entity: 'XLSXAdapter',
        remediation: 'Ejecuta `npm install` en Kubuntu con acceso al registro npm para activar importación/exportación XLSX.',
      }
    );
  }
}

function sanitizeSheetName(rawName, index) {
  const cleaned = String(rawName ?? `Sheet_${index + 1}`)
    .replace(/[\\/?*:[\]]/g, '_')
    .trim()
    .slice(0, 31);
  return cleaned || `Sheet_${index + 1}`;
}

export function createXlsxAdapter({ loadExcelJs = defaultLoadExcelJs } = {}) {
  return {
    format: 'XLSX',

    async isAvailable() {
      try {
        await loadExcelJs();
        return true;
      } catch {
        return false;
      }
    },

    async importFile(filePath) {
      const ExcelJS = await loadExcelJs();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      const documents = [];
      const errors = [];

      workbook.eachSheet(worksheet => {
        let headers = null;
        let headerRowNumber = null;

        worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          const rawValues = Array.isArray(row.values) ? row.values.slice(1) : [];
          const values = rawValues.map(normalizeExcelCellValue);
          const hasAnyContent = values.some(v => String(v ?? '').trim() !== '');
          if (!hasAnyContent) return;

          if (!headers) {
            headerRowNumber = rowNumber;
            headers = values.map((h, i) => {
              const label = String(h ?? '').trim().toLowerCase();
              return label || `col_${i + 1}`;
            });
            return;
          }

          const titleIdx = headers.findIndex(h => ['title', 'titulo', 'título', 'nombre', 'name'].includes(h));
          const contentIdx = headers.findIndex(h => ['content', 'contenido', 'description', 'descripcion', 'descripción'].includes(h));
          const title = String((titleIdx >= 0 ? values[titleIdx] : values[0]) ?? '').trim();
          if (!title) {
            errors.push(`Hoja '${worksheet.name}' fila ${rowNumber}: título vacío, fila omitida.`);
            return;
          }

          const rowObj = {};
          for (let idx = 0; idx < Math.max(headers.length, values.length); idx += 1) {
            const colName = headers[idx] ?? `col_${idx + 1}`;
            rowObj[colName] = values[idx] ?? '';
          }

          documents.push({
            title,
            description: `Hoja '${worksheet.name}' fila ${rowNumber} de ${path.basename(filePath)}`,
            document_type: 'XLSX_ROW',
            content: contentIdx >= 0 ? String(values[contentIdx] ?? '') : JSON.stringify(rowObj),
            metadata: {
              sheet: worksheet.name,
              header_row: headerRowNumber,
              row_number: rowNumber,
              columns: rowObj,
            },
          });
        });
      });

      return { documents, errors };
    },

    async exportDocuments(documents, destination) {
      const ExcelJS = await loadExcelJs();
      const workbook = new ExcelJS.Workbook();

      const bySheet = new Map();
      for (const doc of documents) {
        const sheetName = doc?.metadata?.sheet || 'Documents';
        if (!bySheet.has(sheetName)) bySheet.set(sheetName, []);
        bySheet.get(sheetName).push(doc);
      }
      if (bySheet.size === 0) {
        bySheet.set('Documents', []);
      }

      const usedSheetNames = new Set();
      let idx = 0;
      for (const [rawSheetName, sheetDocs] of bySheet.entries()) {
        let sheetName = sanitizeSheetName(rawSheetName, idx);
        while (usedSheetNames.has(sheetName)) {
          sheetName = sanitizeSheetName(`${rawSheetName}_${idx + 1}`, idx);
        }
        usedSheetNames.add(sheetName);
        idx += 1;

        const baseKeys = ['id', 'title', 'document_type', 'description', 'content', 'version'];
        const extraKeysSet = new Set();
        for (const d of sheetDocs) {
          const cols = d?.metadata?.columns;
          if (cols && typeof cols === 'object' && !Array.isArray(cols)) {
            for (const k of Object.keys(cols)) {
              if (!baseKeys.includes(k)) extraKeysSet.add(k);
            }
          }
        }
        const extraKeys = [...extraKeysSet];
        const sheet = workbook.addWorksheet(sheetName);
        sheet.columns = [
          { header: 'id', key: 'id', width: 38 },
          { header: 'title', key: 'title', width: 32 },
          { header: 'document_type', key: 'document_type', width: 18 },
          { header: 'description', key: 'description', width: 40 },
          { header: 'content', key: 'content', width: 60 },
          { header: 'version', key: 'version', width: 10 },
          ...extraKeys.map(k => ({ header: k, key: `col_${k}`, width: 22 })),
        ];

        for (const d of sheetDocs) {
          const rowData = {
            id: d.id,
            title: d.title,
            document_type: d.document_type,
            description: d.description ?? '',
            content: d.content ?? '',
            version: d.version ?? 1,
          };
          const cols = d?.metadata?.columns ?? {};
          for (const k of extraKeys) {
            rowData[`col_${k}`] = cols[k] ?? '';
          }
          sheet.addRow(rowData);
        }
      }

      fs.mkdirSync(path.dirname(destination), { recursive: true });
      await workbook.xlsx.writeFile(destination);
      return {
        result_reference: destination,
        warnings: ['La exportación XLSX organiza documentos en hojas tabulares; las relaciones de grafo se preservan completas en JSON.'],
      };
    },
  };
}

export const xlsxAdapter = createXlsxAdapter();
