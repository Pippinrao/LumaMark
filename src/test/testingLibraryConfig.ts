import { configure } from '@testing-library/react';

// Vitest testTimeout on CI is 15s because AppShell + CodeMirror + Radix is
// slow when the Windows quality gate runs every file in parallel. findBy /
// waitFor still default to 1s, which is shorter than a cold lazy-dialog import
// (MediaViewerDialog pulls react-zoom-pan-pinch). Keep this under testTimeout
// so a genuine miss still fails with a Testing Library dump.
configure({
  asyncUtilTimeout: process.env.CI ? 10_000 : 1_000,
});
