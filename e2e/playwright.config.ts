import { defineConfig, devices } from '@playwright/test'

const isApiOnly = process.argv.includes('--project=api')
// Point the ui project at an already running dev server (for example
// http://localhost:5173) instead of the built preview on :4173.
const uiBaseURL = process.env.UI_BASE_URL

export default defineConfig({
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  reporter: [['list']],
  projects: [
    {
      name: 'api',
      testDir: './api/specs',
      workers: 1,
      use: {
        baseURL: process.env.API_URL || 'http://localhost:8080',
        extraHTTPHeaders: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      },
    },
    {
      name: 'ui',
      testDir: './ui/specs',
      workers: 2,
      use: {
        baseURL:
          uiBaseURL ?? `http://127.0.0.1:${process.env.FRONTEND_PORT || '4173'}`,
        ...devices['Desktop Chrome'],
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
      },
    },
  ],
  webServer: isApiOnly || uiBaseURL
    ? undefined
    : {
        command: `cd ../frontend && bunx vite preview --host 127.0.0.1 --port ${process.env.FRONTEND_PORT || '4173'} --strictPort`,
        url: `http://127.0.0.1:${process.env.FRONTEND_PORT || '4173'}`,
        reuseExistingServer: !process.env.CI,
        env: {
          ...process.env,
          API_PROXY_TARGET:
            process.env.API_PROXY_TARGET || 'http://127.0.0.1:8080',
          COLLAB_PROXY_TARGET:
            process.env.COLLAB_PROXY_TARGET || 'http://127.0.0.1:1234',
        },
        timeout: 30000,
      },
})
