import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas E2E de SIGUE.
 *
 * Se ejecutan contra la app real (Next en :3000 + API Nest en :3001) sobre la
 * base de datos sembrada con `npm run db:seed`. No se compila la web aquí: el
 * `webServer` levanta `next dev`, porque `next build` comparte el directorio
 * `.next` con el servidor de desarrollo y corrompería la sesión en curso.
 *
 * `workers: 1` es deliberado: las suites comparten la organización demo
 * (registran NC, documentos y auditorías) y el login tiene rate limit por IP.
 */
const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
const reuseExistingServer = !process.env.CI;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    locale: 'es-MX',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Inicia sesión una sola vez y guarda las cookies httpOnly de la sesión.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: [/auth\.setup\.ts/, /auth\.spec\.ts/, /mfa\.spec\.ts/],
    },
    // Flujos sin sesión: login fallido, redirección, recuperación y MFA con una
    // cuenta recién creada (no debe tocar la sesión compartida de la demo).
    {
      name: 'anon',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(auth|mfa)\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: 'npm run dev --workspace @sigue/api',
      url: `${API_URL}/api/v1/health`,
      reuseExistingServer,
      timeout: 240_000,
    },
    {
      command: 'npm run dev --workspace @sigue/web',
      url: WEB_URL,
      reuseExistingServer,
      timeout: 240_000,
    },
  ],
});
