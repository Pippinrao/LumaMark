import { invoke } from '@tauri-apps/api/core';
import { renderDiagram } from './diagramEngines';
import { runHost } from './host';
import type { HostPort } from './host';
import type { RenderJob, Report } from './types';

/**
 * Entry point of `automation-render.html`, the hidden window used by
 * `LumaMark.exe check|diagram render|mcp`.
 */
function createTauriPort(): HostPort {
  return {
    ready: () => invoke('automation_host_ready'),
    nextJob: () => invoke<RenderJob | null>('automation_render_next'),
    progress: (jobId: number, completed: number) =>
      invoke('automation_render_progress', { jobId, completed }),
    result: (jobId: number, report: Report) =>
      invoke('automation_render_result', { jobId, report }),
  };
}

void runHost(createTauriPort(), (job, input) =>
  renderDiagram(input, job.messages, job.limits.timeoutMs),
);
