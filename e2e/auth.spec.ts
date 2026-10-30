import { test, expect } from '@playwright/test';

/**
 * Flujos de sesión sin autenticación previa.
 *
 * Se ejecutan en el proyecto `anon` (sin storageState) y no cierran sesión de
 * nadie: cada test tiene su propio contexto de navegador.
 */
test.describe('Autenticación', () => {
  test('protege las vistas internas y redirige al login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#loginEmail')).toBeVisible();
  });

  test('rechaza credenciales inválidas con un mensaje visible', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#loginEmail').fill('mariana.torres@org.mx');
    await page.locator('#loginPassword').fill('contraseña-incorrecta');
    await page.locator('.signlogin-submit').click();

    // El mensaje viene del servidor ("Credenciales inválidas") y se muestra en
    // el `role="alert"` del formulario, no en un toast. Se acota al formulario:
    // Next añade su propio `role="alert"` (route announcer) fuera de la tarjeta.
    await expect(page.locator('.signlogin-message[role="alert"]')).toContainText(
      'Credenciales inválidas',
    );
    await expect(page).toHaveURL(/\/login/);

    // Y no debe haber creado sesión.
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === 'sigue_rt')).toBeFalsy();
  });

  test('la recuperación de contraseña responde sin revelar si el correo existe', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: '¿Olvidaste tu contraseña?' }).click();

    // El panel de marca de la izquierda también tiene un `h1`, por eso se busca
    // por nombre y no solo por nivel.
    await expect(page.getByRole('heading', { level: 1, name: 'Recuperar acceso' })).toBeVisible();
    await page.locator('#forgotEmail').fill('correo-inexistente@example.com');
    await page.locator('.signlogin-submit').click();

    await expect(page.getByRole('status')).toContainText(
      'Si el correo está registrado, recibirás un enlace en breve.',
    );
  });

  test('inicia sesión con la cuenta demo y cierra sesión', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#loginEmail').fill('mariana.torres@org.mx');
    await page.locator('#loginPassword').fill('demo-password');
    await page.locator('.signlogin-submit').click();

    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mariana');

    // El menú de usuario vive en la topbar; "Cerrar sesión" revoca el refresh y
    // limpia las cookies.
    await page.locator('.topbar-user').click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();

    await expect(page).toHaveURL(/\/login/);
    const cookies = await page.context().cookies();
    expect(cookies.some((c) => c.name === 'sigue_rt')).toBeFalsy();
  });
});
