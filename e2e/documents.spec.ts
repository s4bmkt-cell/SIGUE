import { readFileSync } from 'fs';
import { test, expect } from '@playwright/test';
import { goToView, uniqueSuffix } from './helpers';

/**
 * Control documental: alta, flujo de aprobación, vigencia y distribución.
 *
 * El código debe ser único por organización, así que se usa la marca de la
 * ejecución. El ciclo se detiene en "Publicado": un documento vigente no se
 * elimina (queda como evidencia) y el siguiente paso válido es marcarlo obsoleto.
 * Al final se retira y se borra para dejar la organización como estaba.
 */

/** Fecha local `AAAA-MM-DD` desplazada en días (lo que acepta `<input type="date">`). */
function dateIn(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

test.describe('Ciclo documental', () => {
  test('crea un documento y lo lleva de borrador a publicado', async ({ page }) => {
    const code = `PR-E2E-${Date.now().toString(36).toUpperCase()}`;
    const title = uniqueSuffix('Procedimiento E2E');
    // El alta exige contenido: es lo que después se firma y se verifica.
    const content = 'Contenido del procedimiento de prueba E2E.';
    // Revisión dentro de la ventana de aviso (30 días) y vigencia un año después.
    const reviewDate = dateIn(10);
    const validityUntil = dateIn(365);

    // En el sidebar la vista se llama "Información documentada".
    await goToView(page, 'Información documentada', 'Información documentada');

    // El alta vive en una ventana emergente, abierta desde la cabecera.
    await page.getByRole('button', { name: 'Nuevo documento', exact: true }).click();
    const createDialog = page.getByRole('dialog');
    await expect(createDialog).toBeVisible();

    // Se escribe letra por letra a propósito: con `fill` el valor se fija de una
    // vez y una pérdida de foco tras la primera tecla pasaría inadvertida.
    const codeInput = createDialog.getByPlaceholder('Código (PR-08)');
    await codeInput.pressSequentially(code);
    await expect(codeInput).toHaveValue(code);
    await expect(codeInput).toBeFocused();

    const titleInput = createDialog.getByPlaceholder('Documento', { exact: true });
    await titleInput.fill(title);
    const typeSelect = createDialog.getByLabel('Tipo de documento');
    // El catálogo se lee de arriba a abajo: Proceso va antes que Procedimiento.
    expect((await typeSelect.locator('option').allTextContents()).slice(0, 3)).toEqual([
      'Política',
      'Proceso',
      'Procedimiento',
    ]);
    await typeSelect.selectOption('PROCEDIMIENTO');

    // "Documento" ocupa el mismo ancho que "Área": ambos abarcan dos columnas.
    const titleBox = (await titleInput.boundingBox())!;
    const areaBox = (await createDialog.getByLabel('Área', { exact: true }).boundingBox())!;
    expect(Math.abs(titleBox.width - areaBox.width)).toBeLessThanOrEqual(1);

    await createDialog.getByLabel('Vigente hasta').fill(validityUntil);
    await createDialog.getByLabel('Revisión', { exact: true }).fill(reviewDate);

    // Sedes: se puede marcar ninguna (toda la organización), una o varias. Si la
    // organización no tiene sedes registradas no hay nada que marcar.
    const siteCheckboxes = createDialog.getByRole('checkbox');
    if ((await siteCheckboxes.count()) > 0) {
      await siteCheckboxes.first().check();
      await expect(siteCheckboxes.first()).toBeChecked();
      await expect(createDialog.getByText('El documento aplicará solo a las sedes marcadas.')).toBeVisible();
    }

    await createDialog.getByLabel('Contenido', { exact: true }).fill(content);
    // El archivo es opcional: se adjunta el original y se comprueba que viaja.
    await createDialog.getByLabel('Archivo del documento').setInputFiles({
      name: 'procedimiento.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 procedimiento E2E'),
    });
    await expect(createDialog.getByText('procedimiento.pdf')).toBeVisible();

    await createDialog.getByRole('button', { name: 'Crear documento', exact: true }).click();
    await expect(createDialog).toHaveCount(0);

    // La fila nace en borrador con su versión inicial y su revisión programada.
    const row = page.locator('table tbody tr').filter({ hasText: code });
    await expect(row).toBeVisible();
    await expect(row.getByText('Borrador', { exact: true })).toBeVisible();
    await expect(row.getByText('v1', { exact: true })).toBeVisible();
    await expect(row.getByText('Revisión próxima', { exact: true })).toBeVisible();

    // Flujo: borrador → en revisión → en aprobación → publicado.
    await row.getByRole('button', { name: 'Enviar a revisión', exact: true }).click();
    await expect(row.getByText('En revisión', { exact: true })).toBeVisible();

    // Los filtros del inventario se resuelven en la API y respetan la revisión.
    await page.getByLabel('Filtrar por revisión').selectOption('soon');
    await expect(page.locator('table tbody tr').filter({ hasText: code })).toBeVisible();
    await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
    await expect(row).toBeVisible();

    // El inventario se exporta a CSV respetando los filtros activos. Se
    // comprueba el archivo descargado, no solo el botón: la exportación se pide
    // con la sesión y se arma en el navegador.
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar inventario', exact: true }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/^inventario-documental-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await file.path())!, 'utf8');
    expect(csv.split('\r\n')[0]).toContain('Código');
    expect(csv).toContain(code);

    await row.getByRole('button', { name: 'Aprobar', exact: true }).click();
    await expect(row.getByText('En aprobación', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Publicar', exact: true }).click();
    await expect(row.getByText('Publicado', { exact: true })).toBeVisible();

    // Un documento publicado no se borra: el control lo retira como obsoleto.
    await expect(row.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Marcar obsoleto', exact: true })).toBeVisible();

    // La columna de firmas resume a los firmantes con un círculo de iniciales;
    // el nombre y el tipo de firma quedan en el título del avatar.
    await expect(
      row.getByRole('img', { name: /Mariana Torres · Aprobación/ }),
    ).toBeVisible();

    // El lector muestra el documento tal como está redactado, sin el
    // expediente (flujo, firmas, distribución). Desde ahí se salta a la ficha.
    await row.getByRole('button', { name: 'Leer documento', exact: true }).click();
    const reader = page.getByRole('dialog');
    await expect(reader.getByRole('heading', { name: `${code} · ${title}` })).toBeVisible();
    await expect(reader.getByText(content, { exact: true })).toBeVisible();
    await expect(reader.getByText('Flujo de aprobación')).toHaveCount(0);
    await reader.getByRole('button', { name: 'Ver detalle', exact: true }).click();

    // El panel de detalle reúne metadatos, vigencia, contenido y firmas.
    const detail = page.getByRole('dialog');
    await expect(detail.getByText('Flujo de aprobación')).toBeVisible();
    await expect(detail.getByRole('heading', { name: `${code} · ${title}` })).toBeVisible();
    await expect(detail.getByText('Publicado', { exact: true })).toBeVisible();
    await expect(detail.getByText(content, { exact: true })).toBeVisible();
    // El flujo registra los tres pasos hasta la publicación.
    await expect(detail.getByText('Publicación', { exact: true })).toBeVisible();

    // La vigencia y la revisión quedaron guardadas y son editables.
    await expect(detail.getByText('Vigencia y procedencia')).toBeVisible();
    await expect(detail.getByLabel('Vigente hasta')).toHaveValue(validityUntil);
    await expect(detail.getByLabel('Revisión', { exact: true })).toHaveValue(reviewDate);

    // El archivo cargado en el alta quedó adjunto y se puede descargar.
    await expect(detail.getByText('Archivo adjunto')).toBeVisible();
    await expect(detail.getByText('procedimiento.pdf')).toBeVisible();
    const downloadingFile = page.waitForEvent('download');
    await detail.getByRole('link', { name: 'Descargar archivo', exact: true }).click();
    expect((await downloadingFile).suggestedFilename()).toBe('procedimiento.pdf');

    // También se puede adjuntar después, desde el detalle. Es la ruta que se
    // usa cuando la subida falla durante el alta.
    await detail.getByLabel('Adjuntar archivo').setInputFiles({
      name: 'anexo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 anexo E2E'),
    });
    await expect(detail.getByText('anexo.pdf')).toBeVisible();

    // Un archivo mayor al tope del proxy se rechaza antes de subirlo: el
    // navegador solo vería un 413 de la plataforma, sin explicación.
    await detail.getByLabel('Adjuntar archivo').setInputFiles({
      name: 'enorme.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc(5 * 1024 * 1024),
    });
    await expect(page.getByText(/supera el límite permitido/)).toBeVisible();
    await expect(detail.getByText('enorme.pdf')).toHaveCount(0);

    // La firma de aprobación se verifica contra el contenido actual.
    await detail.getByRole('button', { name: 'Verificar firma', exact: true }).click();
    await expect(detail.getByText('Firma válida', { exact: true })).toBeVisible();
    await expect(detail.getByText('Contenido íntegro', { exact: true })).toBeVisible();

    // Distribución: publicar ya registró la entrega al publicador; se añade otra
    // a una persona y queda como evidencia de la entrega.
    // El nombre aparece también en el selector de destinatario: se acota a la
    // lista de entregas para no confundir la evidencia con una opción.
    await detail.getByLabel('A una persona').selectOption({ label: 'Jorge Aldana' });
    await detail.getByRole('button', { name: 'Registrar entrega', exact: true }).click();
    const deliveries = detail.locator('li').filter({ hasText: 'Jorge Aldana' });
    await expect(deliveries).toHaveCount(1);
    await expect(deliveries).toContainText('Entregado a:');
    await expect(deliveries).toContainText('SISTEMA');

    await detail.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
    await expect(detail).toHaveCount(0);

    // Se deja la organización como estaba: obsoleto (ya no vigente) y borrado.
    // Las acciones de la fila son iconos, así que se localizan por su nombre
    // accesible (`aria-label`), no por texto visible.
    await row.getByRole('button', { name: 'Marcar obsoleto', exact: true }).click();
    await row.getByRole('button', { name: '¿Marcar obsoleto?', exact: true }).click();
    await row.getByRole('button', { name: 'Eliminar documento', exact: true }).click();
    await row.getByRole('button', { name: '¿Eliminar?', exact: true }).click();
    await expect(page.locator('table tbody tr').filter({ hasText: code })).toHaveCount(0);
  });
});
