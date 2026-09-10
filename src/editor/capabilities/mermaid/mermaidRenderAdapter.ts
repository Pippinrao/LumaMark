import type { MermaidRenderSchedulerOptions } from './mermaidRenderScheduler';

export type SafeMermaidConfig = Record<string, unknown> & {
  securityLevel: 'strict';
};

/**
 * The subset of a render context this adapter actually needs.
 *
 * The scheduler passes its full context (which also carries cache-key fields);
 * structural typing keeps that call valid while letting other hosts — such as
 * the bundled automation renderer — reuse the same rendering path.
 */
export type MermaidRenderInput = {
  config: Parameters<MermaidRenderSchedulerOptions['render']>[0]['config'];
  source: string;
  theme: Parameters<MermaidRenderSchedulerOptions['render']>[0]['theme'];
};

export function safeMermaidConfig(
  config: Record<string, unknown> | undefined,
): SafeMermaidConfig {
  return {
    ...config,
    securityLevel: 'strict',
  };
}

export async function renderWithMermaid({
  config,
  source,
  theme,
}: MermaidRenderInput): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  const mermaidTheme = theme === 'dark' ? 'dark' : 'default';
  mermaid.initialize({
    ...safeMermaidConfig(config),
    startOnLoad: false,
    theme: mermaidTheme,
  });
  const result = await mermaid.render(
    `lm-mermaid-${crypto.randomUUID()}`,
    source,
  );

  return result.svg;
}
