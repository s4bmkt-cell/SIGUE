import { test, expect } from '@playwright/test';
import { goToView, uniqueSuffix } from './helpers';

/**
 * Ciclo completo de una no conformidad: registro → corrección → causa raíz →
 * acción correctiva → verificación de eficacia → cierre.
 *
 * Requiere una base sembrada (`npm run db:seed`): los registros creados por la
 * prueba se acumulan como evidencia en la organización demo, y el seed limpia
 * la organización antes de volver a empezar.
 */
test.describe('Ciclo de no conformidad', () => {
  test('registra una NC y la cierra tras verificar la eficacia', async ({ page }) => {
    const title = uniqueSuffix('E2E NC');

    await goToView(page, 'No conformidades', 'No conformidades');

    // 1. Registro
    await page.getByPlaceholder('Título de la NC').fill(title);
    await page.getByPlaceholder('Descripción').fill('Hallazgo generado por la prueba E2E.');
    await page.getByLabel('Prioridad').selectOption('ALTA');
    await page.getByRole('button', { name: 'Registrar NC', exact: true }).click();

    const card = page.locator('div.rounded-card').filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText('Alta', { exact: true })).toBeVisible();
    // El estado aparece dos veces: en el badge y en el stepper del ciclo.
    await expect(card.getByText('Registrada', { exact: true }).first()).toBeVisible();

    // 2. Corrección inmediata
    await card.getByRole('button', { name: 'Abrir', exact: true }).click();
    await card.getByPlaceholder('Agregar corrección').fill('Se restableció el acceso y se avisó al responsable.');
    await card.getByRole('button', { name: 'Añadir', exact: true }).click();
    await expect(card.getByText('Se restableció el acceso y se avisó al responsable.')).toBeVisible();

    // 3. Causa raíz (5 porqués). El campo es un `<input>`: no conserva saltos
    // de línea, así que la comprobación es por el texto visible de la causa.
    await card.getByPlaceholder('Causas (una por línea)').fill('No existe control de caducidad');
    await card.getByPlaceholder('Análisis', { exact: true }).fill('Los permisos no se revisaban desde hace 12 meses.');
    await card.getByRole('button', { name: 'Guardar causa raíz', exact: true }).click();
    await expect(card.getByText('No existe control de caducidad')).toBeVisible();
    await expect(card.getByText('5 porqués', { exact: true })).toBeVisible();

    // 4. Acción correctiva
    await card.getByPlaceholder('Crear acción correctiva').fill('Implantar revisión trimestral de accesos');
    await card.getByRole('button', { name: 'Crear acción', exact: true }).click();
    await expect(card.getByText('Implantar revisión trimestral de accesos')).toBeVisible();

    // Cerrar sin eficacia verificada no debe ser posible: el botón está deshabilitado.
    await expect(card.getByRole('button', { name: 'Cerrar NC', exact: true })).toBeDisabled();

    // 5. Verificación de eficacia: el backend cierra la NC en la misma operación.
    // Con el filtro "Solo abiertas" la tarjeta desaparece de la lista; se
    // comprueba en "Todas" que quedó cerrada y con la acción verificada.
    await card.getByRole('button', { name: 'Eficaz (cerrar)', exact: true }).click();
    await expect(card).toHaveCount(0);

    await page.getByRole('button', { name: /^Todas/ }).click();
    const closed = page.locator('div.rounded-card').filter({ hasText: title }).first();
    await expect(closed).toBeVisible();
    await expect(closed.getByText('Cerrada', { exact: true }).first()).toBeVisible();
  });

  test('elimina una NC abierta desde el botón con confirmación', async ({ page }) => {
    const title = uniqueSuffix('E2E NC borrar');

    await goToView(page, 'No conformidades', 'No conformidades');
    await page.getByPlaceholder('Título de la NC').fill(title);
    await page.getByRole('button', { name: 'Registrar NC', exact: true }).click();

    const card = page.locator('div.rounded-card').filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Abrir', exact: true }).click();

    // `ConfirmButton`: el primer clic solo arma la eliminación.
    const del = card.getByRole('button', { name: 'Eliminar', exact: true });
    await del.click();
    await expect(card.getByRole('button', { name: '¿Eliminar?', exact: true })).toBeVisible();
    await card.getByRole('button', { name: '¿Eliminar?', exact: true }).click();

    await expect(card).toHaveCount(0);
  });
});
