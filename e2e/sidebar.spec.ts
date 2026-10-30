import { test, expect } from '@playwright/test';
import { goToView, openApp } from './helpers';

/**
 * Barra lateral plegable.
 *
 * Plegada queda en riel de iconos y el contenido se desplaza en lugar de
 * quedar debajo. El estado se recuerda entre recargas, así que cada prueba lo
 * restaura al terminar para no afectar a las demás suites (`workers: 1`
 * comparte el contexto del navegador entre archivos).
 */
test.describe('Barra lateral', () => {
  test('se pliega, navega en riel y recuerda el estado', async ({ page }) => {
    await openApp(page);

    const aside = page.locator('aside');
    await expect(aside).toHaveCSS('width', '264px');

    await page.getByRole('button', { name: 'Contraer menú' }).click();
    await expect(aside).toHaveCSS('width', '76px');

    // El panel se desplaza: el margen del contenido sigue al ancho del riel.
    await expect(page.locator('main')).toHaveCSS('margin-left', '76px');

    // Las etiquetas siguen en el árbol accesible (solo visualmente ocultas),
    // así que la navegación funciona igual que desplegada.
    await page
      .locator('.sidebar-nav')
      .getByRole('button', { name: /^Contexto/ })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Contexto de la organización' }),
    ).toBeVisible();

    // El estado sobrevive a una recarga.
    await page.reload();
    await page.locator('.sidebar-nav').waitFor({ timeout: 30_000 });
    await expect(page.locator('aside')).toHaveCSS('width', '76px');

    // Se restaura para el resto de la suite.
    await page.getByRole('button', { name: 'Expandir menú' }).click();
    await expect(page.locator('aside')).toHaveCSS('width', '264px');
    await expect(page.locator('main')).toHaveCSS('margin-left', '264px');
  });

  test('plegada conserva el contador de NC como indicador', async ({ page }) => {
    await openApp(page);
    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: 'Contraer menú' }).click();

    // En el riel el contador numérico se sustituye por un punto, pero el
    // nombre accesible del ítem lo sigue anunciando.
    const nc = page.locator('.sidebar-nav').getByRole('button', { name: /^No conformidades/ });
    await expect(nc).toBeVisible();
    await expect(nc.getByText(/^\d+$/)).toHaveCount(0);

    await page.getByRole('button', { name: 'Expandir menú' }).click();
    await expect(nc.getByText('1', { exact: true })).toBeVisible();
  });
});
