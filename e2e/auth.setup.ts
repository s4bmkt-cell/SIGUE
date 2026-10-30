import { test as setup, expect } from '@playwright/test';
import { login, openApp } from './helpers';

const AUTH_FILE = 'e2e/.auth/user.json';

/**
 * Preparación de sesión para el resto de suites.
 *
 * Sigue el flujo real (formulario → cookies httpOnly de la API) y guarda el
 * estado del contexto. Si esto falla, todos los flujos autenticados fallan con
 * un mensaje claro en vez de mostrar pantallas en blanco.
 *
 * Mariana pertenece a dos organizaciones y la activa por defecto es la primera
 * por nombre ("Demo Consulting Group"), donde es colaborador y no hay normas.
 * Se fija `org-ejemplo` (la organización demo completa) para que las suites
 * trabajen siempre sobre los mismos datos.
 */
setup('inicia sesión con la cuenta demo', async ({ page }) => {
  await login(page, 'mariana.torres@org.mx', 'demo-password');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('Mariana');
  await expect(page.getByRole('button', { name: 'Inicio', exact: true })).toBeVisible();

  // La sesión debe ser por cookie: si la API respondiera solo con tokens en el
  // cuerpo, el estado guardado no tendría cookies y el fallo se vería después.
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === 'sigue_rt' && c.httpOnly)).toBeTruthy();

  await page.evaluate(() => localStorage.setItem('sigue.activeOrgId', 'org-ejemplo'));
  await openApp(page);
  // El selector de la topbar refleja la organización activa.
  await expect(page.getByLabel('Organización activa')).toHaveValue('org-ejemplo');

  await page.context().storageState({ path: AUTH_FILE });
});
