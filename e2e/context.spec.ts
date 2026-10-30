import { test, expect } from '@playwright/test';
import { goToView, openApp } from './helpers';

/**
 * Contexto de la organización como portada de accesos.
 *
 * La vista ya no vuelca las tarjetas de datos: muestra un mosaico de accesos y
 * cada uno abre su sección con la miga «Contexto / Sección». Esta prueba protege
 * las dos cosas: que el mosaico no vuelva a ser la vista de datos y que se pueda
 * entrar y salir de cada sección.
 */
test.describe('Contexto de la organización', () => {
  test('la portada muestra los ocho accesos y no los datos', async ({ page }) => {
    // El lateral usa la etiqueta corta «Contexto»; el h1 conserva el nombre
    // completo de la cláusula.
    await goToView(page, 'Contexto', 'Contexto de la organización');

    for (const label of [
      'FODA',
      'Análisis PESTEL',
      'Partes interesadas',
      'Requisitos legales',
      'Cuestiones internas y externas',
      'Mapa de procesos',
      'Alcance',
      'SoA',
    ]) {
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    }

    // Los elementos del seed solo aparecen dentro de su sección, no en la portada.
    await expect(page.getByText('Equipo de calidad experimentado y comprometido')).toHaveCount(0);
    await expect(page.getByText('LFPDPPP')).toHaveCount(0);

    // La barra lateral sigue señalando «Contexto».
    await expect(
      page.locator('.sidebar-nav').getByRole('button', { name: /^Contexto/ }),
    ).toHaveClass(/bg-primary/);
  });

  test('cada acceso abre su sección y el botón vuelve a la portada', async ({ page }) => {
    await openApp(page);
    await goToView(page, 'Contexto', 'Contexto de la organización');

    // [acceso, título de la sección, contenido que debe aparecer, análisis a abrir]
    const sections: [string, string, string, string?][] = [
      ['FODA', 'FODA', 'FODA 2026', 'FODA 2026'],
      ['Análisis PESTEL', 'Análisis PESTEL', 'PESTEL 2026', 'PESTEL 2026'],
      ['Partes interesadas', 'Partes interesadas', 'Productos conformes a especificación'],
      [
        'Requisitos legales',
        'Requisitos legales',
        'Proteger los datos personales de clientes y empleados',
      ],
      // El seed no registra cuestiones: la sección debe explicarlo, no quedarse en blanco.
      ['Cuestiones internas y externas', 'Cuestiones internas y externas', 'Aún no hay cuestiones registradas.'],
      ['Mapa de procesos', 'Mapa de procesos', 'Requisición de materiales'],
      // El alcance es el `scopeText` de cada norma activa.
      ['Alcance', 'Alcance', 'Procesos de la organización, sus sistemas de información'],
      // La SoA es por norma: el acceso dice «SoA» y la sección declara el nombre completo.
      ['SoA', 'Declaración de Aplicabilidad', 'Políticas para la seguridad de la información'],
    ];

    for (const [tile, heading, content, analysis] of sections) {
      await page.getByRole('button', { name: new RegExp(`^${tile}`) }).click();
      // El h1 cambia al de la sección y la miga permite volver.
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toBeVisible();
      await expect(page.getByRole('button', { name: '← Volver a Contexto' })).toBeVisible();
      await expect(page.getByText(content).first()).toBeVisible();

      // FODA y PESTEL abren primero la lista de análisis: se entra al sembrado.
      // Dentro del detalle el botón vuelve a la lista, no a la portada.
      if (analysis) {
        await page.getByRole('button', { name: `Abrir análisis: ${analysis}` }).click();
        await expect(page.getByRole('heading', { level: 1, name: analysis })).toBeVisible();
        const volverALista = page.getByRole('button', { name: /^← Volver a la lista de/ });
        await expect(volverALista).toBeVisible();
        await volverALista.click();
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      }

      await page.getByRole('button', { name: '← Volver a Contexto' }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Contexto de la organización' }),
      ).toBeVisible();
    }
  });

  test('los accesos muestran cuántos análisis tiene cada sección', async ({ page }) => {
    await goToView(page, 'Contexto', 'Contexto de la organización');

    // FODA y PESTEL cuentan análisis (1 de cada uno), no elementos: los
    // elementos solo se ven al abrir el análisis. Partes 4, legales 2, procesos 3.
    const foda = page.getByRole('button', { name: /^FODA/ });
    await expect(foda.getByText('1', { exact: true })).toBeVisible();
    const pestel = page.getByRole('button', { name: /^Análisis PESTEL/ });
    await expect(pestel.getByText('1', { exact: true })).toBeVisible();
    const parties = page.getByRole('button', { name: /^Partes interesadas/ });
    await expect(parties.getByText('4', { exact: true })).toBeVisible();
    const legal = page.getByRole('button', { name: /^Requisitos legales/ });
    await expect(legal.getByText('2', { exact: true })).toBeVisible();
    const processes = page.getByRole('button', { name: /^Mapa de procesos/ });
    await expect(processes.getByText('3', { exact: true })).toBeVisible();
    // El alcance cuenta normas activas con alcance declarado (las seis del seed).
    const alcance = page.getByRole('button', { name: /^Alcance/ });
    await expect(alcance.getByText('6', { exact: true })).toBeVisible();
    // La SoA cuenta normas con Anexo A activas: ISO 27001 e ISO 42001.
    const soa = page.getByRole('button', { name: /^SoA/ });
    await expect(soa.getByText('2', { exact: true })).toBeVisible();
  });

  test('la SoA alterna entre normas y guarda la aplicabilidad', async ({ page }) => {
    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: /^SoA/ }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Declaración de Aplicabilidad' }),
    ).toBeVisible();

    // Dos declaraciones conviven: cada norma con Anexo A tiene la suya.
    const tabs = page.getByRole('tablist', { name: 'Norma de la declaración' });
    await expect(tabs.getByRole('tab', { name: /ISO27001/ })).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /ISO42001/ })).toBeVisible();

    // 27001 es la primera y trae los controles del Anexo A sembrados.
    await expect(page.getByText('Políticas para la seguridad de la información')).toBeVisible();
    await expect(page.getByText('Datos para el desarrollo de sistemas de IA')).toHaveCount(0);

    // 42001 tiene su propio Anexo A, más corto.
    await tabs.getByRole('tab', { name: /ISO42001/ }).click();
    await expect(page.getByText('Datos para el desarrollo de sistemas de IA')).toBeVisible();
    await expect(page.getByText('Políticas para la seguridad de la información')).toHaveCount(0);

    // Se cambia una implementación y se restaura: la sección no debe dejar
    // rastro de datos de prueba entre corridas.
    const fila = page.locator('tr').filter({ hasText: 'Privacidad' });
    const selector = fila.getByLabel('Implementación A.9');
    const original = await selector.inputValue();
    await selector.selectOption('IMPLEMENTED');
    await expect(fila.getByText('✓')).toBeVisible();
    await selector.selectOption(original);
  });

  test('el alcance editado en Contexto se refleja en Normas y requisitos', async ({ page }) => {
    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: /^Alcance/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Alcance' })).toBeVisible();

    const card = page.locator('li').filter({ hasText: 'ISO22301 · 2019' });
    const original =
      'Procesos críticos de producción, procesamiento de pedidos y facturación en las sedes Monterrey y CDMX.';
    await expect(card.getByText(original)).toBeVisible();

    const nuevo = `${original} Incluye proveedores críticos.`;
    await card.getByRole('button', { name: 'Editar alcance', exact: true }).click();
    const field = page.getByLabel('Alcance del sistema de gestión · ISO22301');
    await expect(field).toHaveValue(original);
    await field.fill(nuevo);
    await card.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(card.getByText(nuevo)).toBeVisible();

    // La otra pantalla comparte la misma fuente de datos: al abrir Normas y
    // requisitos el alcance ya está actualizado, sin recargar nada.
    await goToView(page, 'Normas y requisitos', 'Normas y requisitos');
    await expect(page.getByText(nuevo)).toBeVisible();

    // Se restaura para no alterar el resto de suites.
    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: /^Alcance/ }).click();
    const card2 = page.locator('li').filter({ hasText: 'ISO22301 · 2019' });
    await card2.getByRole('button', { name: 'Editar alcance', exact: true }).click();
    await page.getByLabel('Alcance del sistema de gestión · ISO22301').fill(original);
    await card2.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(card2.getByText(original)).toBeVisible();

    // Y al revés: lo que se guarda en Normas y requisitos aparece en Alcance.
    await goToView(page, 'Normas y requisitos', 'Normas y requisitos');
    const enNormas = page.getByRole('button', { name: /^ISO22301 · 2019/ }).locator('../..');
    await enNormas.getByRole('button', { name: 'Alcance', exact: true }).click();
    await page
      .getByLabel('Alcance del sistema de gestión')
      .fill(`${original} Incluye sedes foráneas.`);
    await enNormas.getByRole('button', { name: 'Guardar', exact: true }).click();

    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: /^Alcance/ }).click();
    await expect(
      page.getByText(`${original} Incluye sedes foráneas.`),
    ).toBeVisible();

    // Restauración final. Hay que esperar a que el editor se cierre —lo hace
    // `onSuccess`, tras el PATCH— antes de comprobar el texto: si se cierra la
    // página con la petición en vuelo, el cambio queda en la base y la suite
    // `normative.spec.ts` encuentra el alcance «foráneas» que esta dejó.
    await page
      .locator('li')
      .filter({ hasText: 'ISO22301 · 2019' })
      .getByRole('button', { name: 'Editar alcance', exact: true })
      .click();
    await page.getByLabel('Alcance del sistema de gestión · ISO22301').fill(original);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByLabel('Alcance del sistema de gestión · ISO22301')).toHaveCount(0);
    await expect(page.getByText(`${original} Incluye sedes foráneas.`)).toHaveCount(0);
    await expect(page.getByText(original)).toBeVisible();
  });

  test('PESTEL registra un factor y lo elimina sin tocar el seed', async ({ page }) => {
    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: /^Análisis PESTEL/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Análisis PESTEL' })).toBeVisible();

    // La sección abre con la lista de análisis; se entra al del seed.
    await page.getByRole('button', { name: 'Abrir análisis: PESTEL 2026' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'PESTEL 2026' })).toBeVisible();

    // Las seis dimensiones están presentes, con sus factores del seed. El
    // selector de alta repite los mismos nombres como `<option>`, así que se
    // comprueba el título de cada tarjeta.
    for (const dimension of [
      'Político',
      'Económico',
      'Social',
      'Tecnológico',
      'Ecológico',
      'Legal',
    ]) {
      await expect(
        page.locator('div.font-bold').filter({ hasText: new RegExp(`^${dimension}$`) }),
      ).toBeVisible();
    }

    const texto = `Factor E2E ${Date.now().toString(36).toUpperCase()}`;
    await page.getByLabel('Dimensión PESTEL').selectOption({ label: 'Tecnológico' });
    await page.getByLabel('Impacto').selectOption({ label: 'Negativo' });
    await page.getByPlaceholder('Agregar factor PESTEL').fill(texto);
    await page.getByRole('button', { name: 'Agregar', exact: true }).click();

    const item = page.locator('li').filter({ hasText: texto });
    await expect(item).toBeVisible();
    await expect(item.getByText('Negativo')).toBeVisible();

    // Se borra para que la sección quede como la dejó el seed.
    await item.hover();
    await item.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await item.getByRole('button', { name: '¿Eliminar?', exact: true }).click();
    await expect(page.getByText(texto)).toHaveCount(0);
  });

  test('crea un FODA nuevo, lo abre y lo elimina', async ({ page }) => {
    await goToView(page, 'Contexto', 'Contexto de la organización');
    await page.getByRole('button', { name: /^FODA/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'FODA' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir análisis: FODA 2026' })).toBeVisible();

    const nombre = `FODA E2E ${Date.now().toString(36).toUpperCase()}`;
    await page.getByRole('button', { name: 'Nuevo FODA', exact: true }).first().click();
    await page.getByLabel('Nombre', { exact: true }).fill(nombre);
    await page.getByLabel('Periodo', { exact: true }).fill('2028');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();

    const tarjeta = page.locator('li').filter({ hasText: nombre });
    await expect(tarjeta).toBeVisible();
    await expect(tarjeta.getByText('2028')).toBeVisible();

    // Se abre el análisis recién creado: nace vacío y lo explica en los
    // cuatro cuadrantes, de ahí el `first()`.
    await page.getByRole('button', { name: `Abrir análisis: ${nombre}` }).click();
    await expect(page.getByRole('heading', { level: 1, name: nombre })).toBeVisible();
    await expect(page.getByText('Aún no hay elementos FODA.').first()).toBeVisible();

    await page.getByRole('button', { name: '← Volver a la lista de FODA' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'FODA' })).toBeVisible();

    // Se elimina para que la sección quede como la dejó el seed.
    const fila = page.locator('li').filter({ hasText: nombre });
    await fila.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await fila.getByRole('button', { name: '¿Eliminar?', exact: true }).click();
    await expect(page.getByText(nombre)).toHaveCount(0);
  });
});
