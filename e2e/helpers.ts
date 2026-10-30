import { expect, type Page } from '@playwright/test';

/**
 * Utilidades compartidas de los E2E.
 *
 * La app no tiene rutas por vista (`app/page.tsx` cambia de vista con estado
 * interno), así que navegar es pulsar el botón del sidebar y esperar el `h1` de
 * la vista destino. Se espera por el título, no por un tiempo fijo: cada vista
 * pide sus datos a la API y el `h1` ya está en el render aunque la tabla siga
 * cargando.
 *
 * El nombre accesible del ítem de NC incluye el contador de abiertas
 * ("No conformidades 5"), por eso se compara por prefijo y no de forma exacta.
 */

/** Abre el panel (la raíz redirige al login si no hay sesión). */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('.sidebar-nav')).toBeVisible({ timeout: 30_000 });
}

/** Navega a una vista del panel; abre la app si el test aún no lo hizo. */
export async function goToView(page: Page, navLabel: string, headingText: string | RegExp) {
  if (!(await page.locator('.sidebar-nav').isVisible().catch(() => false))) {
    await openApp(page);
  }
  await page
    .locator('.sidebar-nav')
    .getByRole('button', { name: new RegExp(`^${escapeRegExp(navLabel)}`) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: headingText })).toBeVisible();
}

/** Inicia sesión con el usuario demo. Deja la sesión en el contexto actual. */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(password);
  await page.locator('.signlogin-submit').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

/** Marca única por ejecución para no chocar con registros previos. */
export function uniqueSuffix(prefix: string) {
  return `${prefix} ${Date.now().toString(36).toUpperCase()}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
