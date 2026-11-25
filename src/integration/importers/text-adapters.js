import fs from 'node:fs';
import path from 'node:path';

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  return rows;
}

function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

export const markdownAdapter = {
  format: 'MARKDOWN',
  importFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const headingMatch = raw.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : path.basename(filePath, path.extname(filePath));
    return {
      documents: [{
        title,
        description: `Importado desde Markdown (${path.basename(filePath)})`,
        document_type: 'MARKDOWN',
        content: raw,
        metadata: { original_file: path.basename(filePath) },
      }],
      errors: [],
    };
  },
  exportDocuments(documents, destination) {
    const content = documents.map(d => `# ${d.title}\n\n${d.content ?? d.description ?? ''}\n`).join('\n---\n\n');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content, 'utf8');
    return {
      result_reference: destination,
      warnings: ['El formato Markdown aplana metadatos estructurados no textuales.'],
    };
  },
};

export const csvAdapter = {
  format: 'CSV',
  importFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const rows = parseCsv(raw);
    if (rows.length < 2) {
      return { documents: [], errors: ['El archivo CSV debe contener encabezados y al menos una fila de datos.'] };
    }
    const headers = rows[0].map(h => h.trim().toLowerCase());
    const titleIdx = headers.findIndex(h => ['title', 'titulo', 'nombre', 'name'].includes(h));
    const contentIdx = headers.findIndex(h => ['content', 'contenido', 'description', 'descripcion'].includes(h));
    const documents = [];
    const errors = [];

    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i];
      const title = (titleIdx >= 0 ? r[titleIdx] : r[0])?.trim();
      if (!title) {
        errors.push(`Fila ${i + 1}: título vacío, fila omitida.`);
        continue;
      }
      const rowObj = {};
      headers.forEach((h, idx) => { rowObj[h || `col_${idx}`] = r[idx] ?? ''; });
      documents.push({
        title,
        description: `Fila ${i + 1} de ${path.basename(filePath)}`,
        document_type: 'SPREADSHEET_ROW',
        content: contentIdx >= 0 ? (r[contentIdx] ?? '') : JSON.stringify(rowObj),
        metadata: { row_index: i + 1, columns: rowObj },
      });
    }
    return { documents, errors };
  },
  exportDocuments(documents, destination) {
    const header = ['id', 'title', 'document_type', 'description', 'content'].join(',');
    const lines = documents.map(d => [d.id, d.title, d.document_type, d.description, d.content ?? ''].map(escapeCsvCell).join(','));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${[header, ...lines].join('\n')}\n`, 'utf8');
    return {
      result_reference: destination,
      warnings: ['CSV conserva una sola hoja plana y no preserva relaciones ni formatos enriquecidos.'],
    };
  },
};

export const jsonAdapter = {
  format: 'JSON',
  importFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { documents: [], errors: [`JSON inválido: ${err.message}`] };
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const documents = [];
    const errors = [];
    items.forEach((item, idx) => {
      if (!item || typeof item !== 'object' || !item.title) {
        errors.push(`Elemento ${idx + 1}: falta campo obligatorio 'title'.`);
        return;
      }
      documents.push({
        title: String(item.title).trim(),
        description: String(item.description ?? '').trim(),
        document_type: item.document_type ?? 'JSON',
        content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? item),
        metadata: item.metadata ?? {},
      });
    });
    return { documents, errors };
  },
  exportDocuments(documents, destination) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(documents, null, 2)}\n`, 'utf8');
    return { result_reference: destination, warnings: [] };
  },
};
