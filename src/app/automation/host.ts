import { runJob } from './diagramReport';
import type { DiagramInput, RenderJob, RenderResult, Report } from './types';

/**
 * Page side of the pull protocol. Rust queues jobs; this loop pulls one job at a
 * time, renders it, and reports back. Nothing else runs on the page.
 */
export type HostPort = {
  /** Announces that the renderer is loaded and ready to pull jobs. */
  ready: () => Promise<void>;
  /** Resolves with the next job, or null when the host is shutting down. */
  nextJob: () => Promise<RenderJob | null>;
  /** Reports per-diagram progress so a stalled renderer can be detected. */
  progress: (jobId: number, completed: number) => Promise<void>;
  /** Delivers the finished report for one job. */
  result: (jobId: number, report: Report) => Promise<void>;
};

/** Renders one diagram for a job; limits and sentences come from the job. */
export type HostRenderer = (
  job: RenderJob,
  input: DiagramInput,
) => Promise<RenderResult>;

export async function runHost(
  port: HostPort,
  render: HostRenderer,
): Promise<void> {
  await port.ready();

  for (;;) {
    let job: RenderJob | null;
    try {
      job = await port.nextJob();
    } catch {
      // The window is going away; stop pulling instead of spinning.
      return;
    }
    if (!job) return;

    const report = await runJob(
      job,
      (input) => render(job, input),
      (completed) => {
        void port.progress(job.jobId, completed).catch(() => undefined);
      },
    );

    try {
      await port.result(job.jobId, report);
    } catch {
      // A lost result is reported by the host watchdog, not by the page.
    }
  }
}
