import { test, expect } from '@playwright/test';
import { openApp } from './helpers';

/**
 * Acceso a "Usuarios y organización" desde el menú de usuario.
 *
 * Regresión: el ítem se mostraba a todos los roles, pero `page.tsx` descartaba
 * la vista en silencio cuando el rol no podía abrirla. Con la organización
 * activa sin permiso y estando ya en el inicio, el clic no producía ningún
 * efecto visible: ni cambio de pantalla, ni mensaje.
 *
 * Mariana es `admin_org` en la organización ejemplo y `colaborador` en la
 * consultora, así que el mismo menú debe comportarse distinto en cada una.
 */
test.describe('Menú de usuario', () => {
  test('abre Usuarios y organización cuando el rol administra', async ({ page }) => {
    await openApp(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mariana');

    await page.locator('.topbar-user').click();
    // El mismo rótulo existe en el sidebar: se apunta al menú desplegable.
    await page
      .locator('.topbar-user-menu')
      .getByRole('button', { name: 'Usuarios y organización' })
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Usuarios y organización' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Miembros', exact: true })).toBeVisible();
  });

  test('guarda los roles de un miembro sin enviar campos ajenos al DTO', async ({ page }) => {
    await openApp(page);

    await page.locator('.topbar-user').click();
    await page
      .locator('.topbar-user-menu')
      .getByRole('button', { name: 'Usuarios y organización' })
      .click();
    await page.getByRole('button', { name: 'Miembros', exact: true }).click();

    const row = page.locator('tr', { hasText: 'mariana.torres@org.mx' });
    await expect(row).toBeVisible();

    // Regresión: la vista mandaba `{ memberId, roles, status }` como cuerpo y la
    // API rechazaba `memberId` («property memberId should not exist») porque ya
    // viaja en la ruta. Se guarda sin cambiar nada: el PATCH debe aceptarse.
    await row.getByRole('button', { name: 'Roles', exact: true }).click();
    await row.getByRole('button', { name: 'Guardar', exact: true }).click();

    await expect(row.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0);
    await expect(page.getByText(/should not exist/)).toHaveCount(0);
    await expect(row.getByText('Administrador', { exact: true })).toBeVisible();
  });

  test('en una organización sin permiso explica el motivo en vez de ignorar el clic', async ({
    page,
  }) => {
    await openApp(page);

    // La consultora es la organización donde Mariana es colaborador.
    await page.getByLabel('Organización activa').selectOption({ label: 'Demo Consulting Group' });

    await page.locator('.topbar-user').click();
    // El menú no debe ofrecer la gestión de usuarios como si fuera posible.
    await expect(page.getByRole('button', { name: 'Mi suscripción' })).toHaveCount(0);
    await page
      .locator('.topbar-user-menu')
      .getByRole('button', { name: 'Usuarios y organización' })
      .click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Usuarios y organización' }),
    ).toBeVisible();
    await expect(
      page.getByText('Solo los administradores de la organización pueden gestionar usuarios'),
    ).toBeVisible();

    // Y ofrece el atajo a la organización donde sí administra.
    await expect(
      page.getByRole('button', { name: 'Organización Ejemplo, S.A. de C.V.' }),
    ).toBeVisible();
  });
});
