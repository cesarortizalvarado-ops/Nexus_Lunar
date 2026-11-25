import { apiFetch, escapeHtml, FALLBACK_CLINICAL_RANGES, FALLBACK_EXERCISES, showToast } from '../api.js';
import { state } from '../state.js';

export async function renderLibrariesView(contentEl) {
  const [libraries, documents] = await Promise.all([
    apiFetch('/api/libraries'),
    apiFetch('/api/knowledge/documents'),
  ]);
  state.libraries = libraries || [];
  state.libraryDocuments = documents || [];
  if (!state.selectedLibraryId && state.libraries.length > 0) {
    state.selectedLibraryId = state.libraries[0].id;
  }

  const exercises = state.catalog?.standardExercises || FALLBACK_EXERCISES;
  const clinicalRanges = state.catalog?.clinicalRanges || FALLBACK_CLINICAL_RANGES;

  contentEl.innerHTML = `
    <article class="card">
      <div class="card-head">
        <div>
          <h2>Bibliotecas Externas y Semilla MX</h2>
          <small>Catálogo inicial determinista: 27 insumos en MXN, 15 recetas saludables y documentos propios</small>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="lib-seed-starter-btn">Cargar Biblioteca Inicial (15 Recetas MX + Despensa)</button>
      </div>
      ${
        state.seedResult
          ? `
        <div class="alert-banner ok">
          <span>
            <strong>Catálogo sincronizado:</strong> ${state.seedResult.productsCreated} productos creados (${state.seedResult.productsExisting} existentes) ·
            ${state.seedResult.recipesCreated} recetas creadas (${state.seedResult.recipesExisting} existentes).
          </span>
        </div>
      `
          : '<small style="color:var(--text-secondary);">La carga inicial es idempotente y nunca duplica registros.</small>'
      }
    </article>

    <div class="grid-2">
      <article class="card">
        <div class="card-head"><h3>Bibliotecas (${state.libraries.length})</h3></div>
        <form id="lib-create-form" style="display:flex;gap:8px;margin-bottom:12px;">
          <input type="text" name="name" required placeholder="Nueva biblioteca (ej. Recetas Casa)...">
          <input type="text" name="category" value="general" placeholder="Categoría" style="max-width:130px;">
          <button type="submit" class="btn btn-primary btn-sm">Crear</button>
        </form>
        <div class="list-stack">
          ${state.libraries
            .map(
              (lib) => `
            <div class="list-row">
              <span><strong>${escapeHtml(lib.name)}</strong> <small style="color:var(--text-secondary);">(${escapeHtml(lib.category || 'general')})</small></span>
              <span class="badge">${escapeHtml(lib.status)}</span>
            </div>
          `
            )
            .join('') || '<small>Sin bibliotecas creadas aún.</small>'}
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Documentos de Conocimiento (${state.libraryDocuments.length})</h3></div>
        <form id="doc-create-form" class="list-stack" style="margin-bottom:12px;">
          <select name="library_id" required>
            ${state.libraries.map((l) => `<option value="${escapeHtml(l.id)}" ${l.id === state.selectedLibraryId ? 'selected' : ''}>${escapeHtml(l.name)}</option>`).join('') || '<option value="">Crea o siembra una biblioteca primero</option>'}
          </select>
          <input type="text" name="title" required placeholder="Título del documento o receta...">
          <textarea name="content" rows="2" placeholder="Contenido o notas..."></textarea>
          <button type="submit" class="btn btn-primary btn-sm" ${state.libraries.length === 0 ? 'disabled' : ''}>Guardar Documento</button>
        </form>
        <div class="list-stack">
          ${state.libraryDocuments
            .slice(0, 10)
            .map(
              (doc) => `
            <div class="list-row">
              <span>${escapeHtml(doc.title)}</span>
              <span class="badge badge-accent">${escapeHtml(doc.document_type || 'MARKDOWN')}</span>
            </div>
          `
            )
            .join('') || '<small>Sin documentos indexados.</small>'}
        </div>
      </article>
    </div>

    <div class="grid-2">
      <article class="card">
        <div class="card-head"><h3>Ejercicios Estándar (Catálogo del Núcleo)</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Nombre</th><th>Categoría</th><th>METs</th><th>Duración base</th></tr></thead>
            <tbody>
              ${exercises
                .map(
                  (ex) => `
                <tr>
                  <td>${escapeHtml(ex.name)}</td>
                  <td><span class="badge">${escapeHtml(ex.category)}</span></td>
                  <td class="mono">${escapeHtml(ex.mets)}</td>
                  <td class="mono">${escapeHtml(ex.defaultDurationMinutes ?? 30)} min</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </article>

      <article class="card">
        <div class="card-head"><h3>Referencias Clínicas Canónicas</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Biomarcador</th><th>Mín</th><th>Máx</th><th>Unidad</th></tr></thead>
            <tbody>
              ${Object.values(clinicalRanges)
                .map(
                  (r) => `
                <tr>
                  <td>${escapeHtml(r.label)}</td>
                  <td class="mono">${escapeHtml(r.min)}</td>
                  <td class="mono">${escapeHtml(r.max)}</td>
                  <td>${escapeHtml(r.unit)}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  `;
}

export async function handleLibrariesClick(e, rerender) {
  if (e.target.id === 'lib-seed-starter-btn') {
    const result = await apiFetch('/api/knowledge/seed-starter', { method: 'POST', body: JSON.stringify({}) });
    state.seedResult = result;
    showToast(`Catálogo cargado: ${result.recipesCreated} recetas nuevas, ${result.productsCreated} insumos nuevos.`, { type: 'ok' });
    await rerender();
    return true;
  }
  return false;
}

export async function handleLibrariesSubmit(form, rerender) {
  const fd = new FormData(form);
  if (form.id === 'lib-create-form') {
    await apiFetch('/api/libraries', {
      method: 'POST',
      body: JSON.stringify({
        name: fd.get('name'),
        category: fd.get('category') || 'general',
      }),
    });
    showToast('Biblioteca creada.', { type: 'ok' });
    await rerender();
    return true;
  }
  if (form.id === 'doc-create-form') {
    await apiFetch('/api/knowledge/documents', {
      method: 'POST',
      body: JSON.stringify({
        library_id: fd.get('library_id'),
        title: fd.get('title'),
        content: fd.get('content') || '',
      }),
    });
    showToast('Documento guardado en biblioteca.', { type: 'ok' });
    await rerender();
    return true;
  }
  return false;
}
