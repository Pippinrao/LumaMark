import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
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
    ],
    globals: false,
  },
});
