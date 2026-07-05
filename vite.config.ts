import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const PNPM_NESTED_NODE_MODULE = String.raw`(?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?`;
const NODE_MODULE = String.raw`node_modules[\\/]${PNPM_NESTED_NODE_MODULE}`;

function dependencyGroupPattern(packages: string): RegExp {
  return new RegExp(`${NODE_MODULE}(${packages})[\\\\/]`);
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              priority: 40,
              test: dependencyGroupPattern('react|react-dom|scheduler'),
            },
            {
              name: 'vendor-codemirror',
              maxSize: 420_000,
              priority: 35,
              test: dependencyGroupPattern('@codemirror|@lezer'),
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
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    exclude: [
      ...configDefaults.exclude,
      '**/.claude/**',
      '**/.codex/**',
      '**/.cursor/**',
      '**/.worktrees/**',
      '**/src-tauri/target/**',
      '**/target/**',
      '**/tests/e2e/**',
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
