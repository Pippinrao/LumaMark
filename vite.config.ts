import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const configDir = fileURLToPath(new URL('.', import.meta.url));
const parentNodeModules = path.resolve(configDir, '../../node_modules');
const serverFsAllow = [configDir];
if (
  configDir.includes(`${path.sep}.worktrees${path.sep}`) &&
  existsSync(parentNodeModules)
) {
  // Shared worktree junctions resolve packages in the main checkout.
  serverFsAllow.push(parentNodeModules);
}

const PNPM_NESTED_NODE_MODULE = String.raw`(?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?`;
const NODE_MODULE = String.raw`node_modules[\\/]${PNPM_NESTED_NODE_MODULE}`;

function dependencyGroupPattern(packages: string): RegExp {
  return new RegExp(`${NODE_MODULE}(${packages})[\\\\/]`);
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 7000,
    rolldownOptions: {
      // MathJax NewCM WOFF2 + lazy PlantUML TeaVM copy time trips Rolldown's
      // vite:asset PLUGIN_TIMINGS diagnostic. quality:web-build still fails
      // any PLUGIN_TIMINGS that names a different plugin.
      checks: {
        pluginTimings: false,
      },
      output: {
        // Mermaid contains static import cycles across its diagram modules. Keep
        // their source execution order when the size-based vendor group splits.
        strictExecutionOrder: true,
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              priority: 40,
              test: dependencyGroupPattern('react|react-dom|scheduler'),
            },
            {
              name: 'vendor-codemirror-core',
              priority: 35,
              test: dependencyGroupPattern(
                [
                  '@codemirror/autocomplete',
                  '@codemirror/commands',
                  '@codemirror/lang-markdown',
                  '@codemirror/language',
                  '@codemirror/lint',
                  '@codemirror/search',
                  '@codemirror/state',
                  '@codemirror/view',
                  '@lezer/common',
                  '@lezer/highlight',
                  '@lezer/lr',
                  '@lezer/markdown',
                ].join('|'),
              ),
            },
            {
              name: 'vendor-ui',
              maxSize: 420_000,
              priority: 30,
              test: dependencyGroupPattern(
                [
                  '@radix-ui',
                  'cmdk',
                  'i18next',
                  'lucide-react',
                  'react-arborist',
                  'react-i18next',
                  'react-resizable-panels',
                  'zustand',
                ].join('|'),
              ),
            },
            {
              name: 'vendor-mermaid-heavy',
              maxSize: 420_000,
              priority: 25,
              test: dependencyGroupPattern(
                [
                  '@mermaid-js',
                  'cytoscape',
                  'cytoscape-cose-bilkent',
                  'd3',
                  'dagre',
                  'dompurify',
                  'katex',
                  'khroma',
                  'mermaid',
                  'roughjs',
                  'stylis',
                  'vscode-languageserver-types',
                ].join('|'),
              ),
            },
          ],
        },
      },
    },
  },
  server: {
    fs: {
      allow: serverFsAllow,
    },
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  worker: {
    format: 'es',
  },
  test: {
    environment: 'jsdom',
    // Full AppShell + CodeMirror + Radix suites exceed the 5s default when the
    // Windows quality gate runs every file in parallel.
    testTimeout: process.env.CI ? 15_000 : 5_000,
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      '**/.codex/**',
      '**/.cursor/**',
      '**/.pnpm-store/**',
      '**/.worktrees/**',
      '**/src-tauri/target/**',
      '**/target/**',
      '**/tests/e2e/**',
      '**/tests/production-e2e/**',
    ],
    globals: false,
    setupFiles: ['src/test/browserApiStubs.ts'],
    server: {
      deps: {
        inline: [
          'codemirror-markdown-tables',
          '@floating-ui/dom',
          '@mobily/ts-belt',
          'clsx',
        ],
      },
    },
  },
});
