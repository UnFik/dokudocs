/// <reference types="vitest/config" />
import path from 'path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'
import { createHash } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'

function serviceWorkerPrecache(): Plugin {
  let assets: string[] = []
  return {
    name: 'service-worker-precache',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle).filter((fileName) =>
        /^assets\/.*\.(js|css)$/.test(fileName)
      )
    },
    writeBundle(outputOptions) {
      const cacheName = `dokudocs-shell-${createHash('sha256')
        .update(assets.join('\n'))
        .digest('hex')
        .slice(0, 12)}`
      const workerPath = path.resolve(
        outputOptions.dir ?? 'dist',
        'service-worker.js'
      )
      const source = readFileSync(workerPath, 'utf8')
      writeFileSync(
        workerPath,
        source
          .replace('__DOKUDOCS_CACHE_NAME__', cacheName)
          .replace(
            '__DOKUDOCS_PRECACHE_ASSETS__',
            JSON.stringify(assets.map((fileName) => `/${fileName}`))
          )
      )
      chmodSync(workerPath, 0o644)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget =
    process.env.API_PROXY_TARGET ||
    env.API_PROXY_TARGET ||
    'http://localhost:8080'
  const collabTarget =
    process.env.COLLAB_PROXY_TARGET ||
    env.COLLAB_PROXY_TARGET ||
    'http://localhost:1234'
  const proxy = {
    '/api': {
      target: proxyTarget,
      changeOrigin: false,
    },
    // The collaboration service (Hocuspocus) speaks WebSocket on the same origin.
    '/collab': {
      target: collabTarget,
      changeOrigin: false,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/collab/, '') || '/',
    },
  }
  const callbackHeaders = (server: {
    middlewares: {
      use: (
        handler: (
          req: { url?: string },
          res: { setHeader: (name: string, value: string) => void },
          next: () => void
        ) => void
      ) => void
    }
  }) => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] === '/auth/callback') {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Referrer-Policy', 'no-referrer')
      }
      next()
    })
  }
  return {
    server: { proxy },
    preview: { proxy },
    plugins: [
      {
        name: 'auth-callback-headers',
        configureServer: callbackHeaders,
        configurePreviewServer: callbackHeaders,
      },
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      serviceWorkerPrecache(),
    ],
    optimizeDeps: {
      include: [
        '@tanstack/react-query',
        '@tanstack/react-query-devtools',
        '@tanstack/react-router-devtools',
        'react-dom/client',
        'react-top-loading-bar',
        'monaco-editor',
        'monaco-editor/editor/editor.worker',
        'prismjs',
        'prismjs/plugins/keep-markup/prism-keep-markup',
        'prosemirror-model',
        'prosemirror-state',
        'prosemirror-view',
        'y-prosemirror',
        'yjs',
      ],
    },
    resolve: {
      dedupe: [
        'prosemirror-model',
        'prosemirror-state',
        'prosemirror-view',
        'yjs',
      ],
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@muyajs/core': path.resolve(__dirname, './src/features/docs/lib/muya'),
      },
    },
    test: {
      silent: 'passed-only',
      unstubEnvs: true,
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
      coverage: {
        // include: ['src/**/*.{js,jsx,ts,tsx}'], // Uncomment to expand the report to all src/**/* so untested modules appear as 0% coverage.
        exclude: [
          'src/components/ui/**',
          'src/assets/**',
          'src/tanstack-table.d.ts',
          'src/routeTree.gen.ts',
          'src/test-utils/**',
          'src/routes/**',
        ],
      },
    },
  }
})
