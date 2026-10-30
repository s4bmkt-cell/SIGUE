import { test, expect } from '@playwright/test';
import { goToView, uniqueSuffix } from './helpers';

/**
 * Auditoría interna: alta, lista de verificación, hallazgo y cierre.
 *
 * `Cerrar auditoría` exige que todas las respuestas de la lista estén
 * contestadas — es la regla que se comprueba al final.
 */
test.describe('Auditoría interna', () => {
  test('programa una auditoría, la ejecuta y la cierra', async ({ page }) => {
    const title = uniqueSuffix('E2E Auditoría');

    await goToView(page, 'Auditorías', 'Auditorías');

    await page.getByPlaceholder('Título de la auditoría').fill(title);
    await page.getByPlaceholder('Alcance y fechas').fill('Procesos de operación y soporte');
    await page.getByRole('button', { name: 'Nueva auditoría', exact: true }).click();

    const card = page.locator('div.rounded-card').filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText('Planeada', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Abrir', exact: true }).click();

    // 1. Lista de verificación derivada de los requisitos activos.
    await expect(card.getByText('Sin ítems de verificación')).toBeVisible();
    await card.getByRole('button', { name: 'Generar lista de verificación', exact: true }).click();

    const pendingHint = card.getByText(/Responde todos los ítems de la lista antes de cerrar\./);
    await expect(pendingHint).toBeVisible();

    // 2. Todas las respuestas: sin esto el cierre queda bloqueado.
    // Cada clic dispara una mutación y un refetch; se repiten pasadas hasta que
    // la lista quede completa en lugar de asumir que cada clic se aplicó. El
    // número de ítems depende de la norma con la que se generó la lista (hasta
    // 120), así que se insiste hasta un límite amplio y no con un número fijo.
    for (let pass = 0; pass < 20; pass += 1) {
      if ((await pendingHint.count()) === 0) break;
      const conformes = card.getByRole('button', { name: 'Conforme', exact: true });
      const count = await conformes.count();
      for (let i = 0; i < count; i += 1) {
        await conformes.nth(i).click();
      }
      await page.waitForTimeout(500);
    }
    await expect(pendingHint).toHaveCount(0, { timeout: 30_000 });

    // 3. Hallazgo registrado durante la auditoría.
    await page.getByLabel('Tipo de hallazgo').selectOption('NON_CONFORMITY');
    await page
      .getByPlaceholder('Descripción del hallazgo')
      .fill('Un procedimiento no tiene evidencia de revisión vigente.');
    await card.getByRole('button', { name: 'Registrar hallazgo', exact: true }).click();
    await expect(
      card.getByText('Un procedimiento no tiene evidencia de revisión vigente.'),
    ).toBeVisible();
    await expect(card.getByText('No conformidad', { exact: true }).first()).toBeVisible();

    // 4. Cierre (confirmación en dos pasos). La auditoría cerrada pasa a
    // "Completada" y el botón de cierre desaparece.
    await card.getByRole('button', { name: 'Cerrar auditoría', exact: true }).click();
    await card.getByRole('button', { name: '¿Eliminar?', exact: true }).click();
    await expect(card.getByText('Completada', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Cerrar auditoría', exact: true })).toHaveCount(0);
  });
});
