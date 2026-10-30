import { test, expect, type Page } from '@playwright/test';
import { authenticator } from 'otplib';
import { uniqueSuffix } from './helpers';

/**
 * Activación y uso del segundo factor (TOTP) de punta a punta.
 *
 * Se usa una cuenta nueva por ejecución: activar MFA sobre una cuenta demo
 * dejaría las demás suites pidiendo un código que no conocen. El usuario nace
 * sin organización, así que el flujo se limita a lo que no depende del tenant
 * (login, seguridad de la cuenta) y no interfiere con los datos demo.
 *
 * El límite de intentos de login es por IP (5/min): este test hace dos y el
 * resto de suites unos pocos más, así que se ejecuta en el proyecto `anon`
 * con `workers: 1`.
 */
test.describe('MFA (segundo factor)', () => {
  test('activa el MFA con QR, inicia sesión con código y lo desactiva', async ({ page }) => {
    const email = `mfa.${Date.now().toString(36)}@org.mx`;
    const password = 'demo-password';

    // Alta de la cuenta por la API pública: el objetivo del test es el MFA,
    // no repetir el formulario de registro.
    const registered = await page.request.post('/api/v1/auth/register', {
      data: { name: uniqueSuffix('Usuario MFA'), email, password },
    });
    expect(registered.ok()).toBeTruthy();

    await loginWithPassword(page, email, password);

    // Menú de usuario → Seguridad.
    await page.locator('.topbar-user').click();
    await page.getByRole('button', { name: 'Seguridad y MFA', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Seguridad' })).toBeVisible();
    await expect(page.getByText('Desactivado', { exact: true })).toBeVisible();

    // Genera el QR y la clave manual. La semilla que se muestra es la que la
    // API guardó (cifrada): el código calculado a partir de ella debe activar.
    await page.getByRole('button', { name: 'Activar MFA', exact: true }).click();
    const qr = page.getByAltText('Código QR para registrar el autenticador');
    await expect(qr).toBeVisible();
    await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);

    const secret = (await page.locator('code').first().innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);

    const codeInput = page.getByLabel('Código de verificación');
    await codeInput.fill(authenticator.generate(secret));
    await page.getByRole('button', { name: 'Confirmar y activar', exact: true }).click();

    await expect(page.getByText('Activado', { exact: true })).toBeVisible();
    await expect(page.getByText('MFA activado. La próxima vez se pedirá el código.')).toBeVisible();

    // Cierra la sesión y vuelve a entrar: ahora el acceso exige el código.
    await page.locator('.topbar-user').click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/login/);

    await loginWithPassword(page, email, password);
    await expect(page.locator('#mfaCode')).toBeVisible();
    await page.locator('#mfaCode').fill(authenticator.generate(secret));
    await page.locator('.signlogin-submit').click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
    await expect(page.locator('.sidebar-nav')).toBeVisible();

    // Desactivación: exige un código vigente y deja la cuenta como estaba.
    await page.locator('.topbar-user').click();
    await page.getByRole('button', { name: 'Seguridad y MFA', exact: true }).click();
    await page.getByRole('button', { name: 'Desactivar MFA', exact: true }).click();
    await page.getByLabel('Código actual para desactivar').fill(authenticator.generate(secret));
    await page.getByRole('button', { name: 'Desactivar', exact: true }).click();

    await expect(page.getByText('Desactivado', { exact: true })).toBeVisible();
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.ok()).toBeTruthy();
    expect((await me.json()).mfaEnabled).toBe(false);
  });
});

/** Completa el formulario de credenciales y espera a que el paso avance. */
async function loginWithPassword(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('.signlogin-submit').click();
  // O entra al panel o pasa al segundo factor; ambos son un éxito del paso 1.
  await expect(page.locator('#mfaCode').or(page.locator('.sidebar-nav'))).toBeVisible({
    timeout: 30_000,
  });
}
