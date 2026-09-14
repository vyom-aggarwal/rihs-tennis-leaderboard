import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests run against the production build, served by e2e/server.mjs with the real
 * publishing function and a fixture sheet. Three servers cover the three ways the site
 * can be deployed: publishing configured, publishing not yet configured, and a static host
 * with no publishing API at all.
 *
 * Locally the tests use the installed Google Chrome; CI installs Playwright's Chromium.
 */

const CI = Boolean(process.env.CI);
const channel = CI ? undefined : 'chrome';

export const PORTS = { published: 4310, unconfigured: 4311, linkOnly: 4312 } as const;

const server = (port: number, publishing: string) => ({
  command: 'node e2e/server.mjs',
  url: `http://127.0.0.1:${port}/`,
  env: { PORT: String(port), PUBLISHING: publishing },
  // Every run starts from an empty in-memory store.
  reuseExistingServer: false,
  timeout: 30_000,
});

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  reporter: CI ? 'github' : 'list',
  // Hard caps, so a browser that stops rendering (it happens with a real Chrome window on
  // a busy desktop) fails one action quickly instead of stalling the whole run.
  globalTimeout: 10 * 60_000,
  use: { trace: 'retain-on-failure', actionTimeout: 15_000, navigationTimeout: 20_000 },
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], channel },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'], channel },
    },
  ],
  webServer: [
    server(PORTS.published, 'on'),
    server(PORTS.unconfigured, 'unconfigured'),
    server(PORTS.linkOnly, 'off'),
  ],
});
