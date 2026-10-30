import { test, expect } from '@playwright/test';
import { goToView } from './helpers';

/**
 * Contenido normativo: la organización demo tiene las seis normas activas y
 * el catálogo completo cargado.
 *
 * Los conteos salen de los datos del seed (`iso27001-data.ts`,
 * `iso22301-data.ts`, `iso20000-data.ts` e `iso37001-data.ts`) y protegen
 * contra una regresión silenciosa del catálogo: una norma sin cláusulas deja
 * el diagnóstico y el cumplimiento en cero sin mostrar ningún error.
 */
test.describe('Contenido normativo', () => {
  test('ISO/IEC 27001 muestra los 93 controles del Anexo A en la SOA', async ({ page }) => {
    await goToView(page, 'ISO/IEC 27001', 'ISO/IEC 27001 · Seguridad de la información');

    // La Declaración de Aplicabilidad es la única tabla de la vista.
    const soaRows = page.locator('table tbody tr');
    await expect(soaRows.first()).toBeVisible();
    await expect(soaRows).toHaveCount(93);

    // Los cinco controles excluidos justificadamente deben existir y estar
    // marcados como no aplicables (su select de implementación queda deshabilitado).
    for (const code of ['A.5.21', 'A.5.30', 'A.8.30', 'A.8.31', 'A.8.34']) {
      const row = page.locator('table tbody tr').filter({ hasText: code });
      await expect(row).toHaveCount(1);
      await expect(row.locator('select').first()).toHaveValue('NO');
    }
  });

  test('las seis normas activas aparecen con su cumplimiento en el tablero', async ({
    page,
  }) => {
    await goToView(page, 'Tableros', 'Tableros');

    for (const code of [
      'ISO9001',
      'ISO27001',
      'ISO22301',
      'ISO20000',
      'ISO37001',
      'ISO42001',
    ]) {
      await expect(page.getByRole('button', { name: new RegExp(`^${code} `) })).toBeVisible();
    }

    // El desglose por cláusula solo se pide al desplegar la norma.
    await page.getByRole('button', { name: /^ISO27001 / }).click();
    await expect(page.getByRole('button', { name: /^ISO27001 / })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('li').filter({ hasText: 'A.5.1' }).first()).toBeVisible();
  });

  test('cada norma expone sus requisitos con niveles editables', async ({ page }) => {
    await goToView(page, 'Normas y requisitos', 'Normas y requisitos');

    // ISO 27001: 11 cláusulas de encabezado + 118 requisitos.
    await page.getByRole('button', { name: /^ISO27001 · 2022/ }).click();
    await expect(
      page.getByRole('heading', { level: 3, name: /Requisitos · ISO27001/ }),
    ).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(129);

    // ISO 22301: 7 cláusulas + 26 requisitos.
    await page.getByRole('button', { name: /^ISO22301 · 2019/ }).click();
    await expect(
      page.getByRole('heading', { level: 3, name: /Requisitos · ISO22301/ }),
    ).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(33);

    // ISO/IEC 20000-1: 10 cláusulas + 47 requisitos.
    await page.getByRole('button', { name: /^ISO20000 · 2018/ }).click();
    await expect(
      page.getByRole('heading', { level: 3, name: /Requisitos · ISO20000/ }),
    ).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(57);

    // ISO 37001: 10 cláusulas + 31 requisitos.
    await page.getByRole('button', { name: /^ISO37001 · 2025/ }).click();
    await expect(
      page.getByRole('heading', { level: 3, name: /Requisitos · ISO37001/ }),
    ).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(41);

    // El nivel de un requisito se actualiza sin recargar la página. Se restaura
    // el valor original para no alterar el cumplimiento que el seed dejó fijo
    // (los tableros y el diagnóstico dependen de esos porcentajes).
    const firstSelect = page
      .locator('table tbody tr')
      .filter({ has: page.locator('select') })
      .first()
      .locator('select');
    const before = await firstSelect.inputValue();
    const target = before === 'MATURE' ? 'IMPLEMENTED' : 'MATURE';

    await firstSelect.selectOption(target);
    await expect(firstSelect).toHaveValue(target);

    await firstSelect.selectOption(before);
    await expect(firstSelect).toHaveValue(before);
  });

  test('todas las normas activas muestran su alcance y se puede corregir', async ({ page }) => {
    await goToView(page, 'Normas y requisitos', 'Normas y requisitos');

    // Regresión: las normas activadas por una ejecución previa del seed se
    // quedaban sin descripción y la tarjeta aparecía vacía.
    await expect(page.getByText('Sin alcance definido para esta norma')).toHaveCount(0);
    await expect(
      page.getByText(/Procesos de la organización, sus sistemas de información/),
    ).toBeVisible();

    // El alcance se puede declarar después de activar la norma. La tarjeta es
    // el abuelo del botón de la norma: `div > flex > [norma, Alcance]`.
    const card = page.getByRole('button', { name: /^ISO22301 · 2019/ }).locator('../..');
    const original =
      'Procesos críticos de producción, procesamiento de pedidos y facturación en las sedes Monterrey y CDMX.';
    await card.getByRole('button', { name: 'Alcance', exact: true }).click();
    const field = page.getByLabel('Alcance del sistema de gestión');
    await expect(field).toHaveValue(original);

    const nuevo = `${original} Incluye proveedores críticos.`;
    await field.fill(nuevo);
    await card.getByRole('button', { name: 'Guardar', exact: true }).click();
    // Al guardar se cierra el editor y la tarjeta refleja el texto nuevo.
    await expect(field).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Incluye proveedores críticos/ })).toBeVisible();

    // Se restaura para no alterar el resto de suites.
    await card.getByRole('button', { name: 'Alcance', exact: true }).click();
    await page.getByLabel('Alcance del sistema de gestión').fill(original);
    await card.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(field).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Incluye proveedores críticos/ })).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Procesos críticos de producción/ })).toBeVisible();
  });

  test('ISO 22301 muestra BIA, planes y ejercicios', async ({ page }) => {
    await goToView(page, 'ISO 22301', 'ISO 22301 · Continuidad del negocio');

    await expect(
      page.getByRole('heading', { level: 3, name: 'Análisis de Impacto al Negocio (BIA)' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Planes de continuidad' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Pruebas y ejercicios' })).toBeVisible();
  });

  test('ISO/IEC 20000-1 muestra catálogo de servicios, SLA y casos', async ({ page }) => {
    await goToView(page, 'ISO/IEC 20000-1', 'ISO/IEC 20000-1 · Gestión de servicios de TI');

    await expect(
      page.getByRole('heading', { level: 3, name: 'Catálogo de servicios' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Acuerdos de nivel de servicio' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Incidentes y peticiones' }),
    ).toBeVisible();

    // Los tres servicios del seed deben llegar desde la API, no de DEMO_*.
    await expect(page.getByText('SRV-01', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('INC-2026-091', { exact: true })).toBeVisible();
  });

  test('ISO 37001 muestra riesgos, controles e investigaciones', async ({ page }) => {
    await goToView(page, 'ISO 37001', 'ISO 37001 · Gestión antisoborno');

    await expect(page.getByRole('heading', { level: 3, name: 'Riesgo de soborno' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Controles antisoborno' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: 'Incidentes e investigaciones' }),
    ).toBeVisible();

    // El riesgo de licitaciones del seed tiene puntaje 20 (4 × 5).
    await expect(page.getByRole('cell', { name: '20', exact: true })).toBeVisible();
  });
});
