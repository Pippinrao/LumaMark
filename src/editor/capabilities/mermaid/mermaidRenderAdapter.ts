import type { MermaidRenderSchedulerOptions } from './mermaidRenderScheduler';

export type SafeMermaidConfig = Record<string, unknown> & {
  securityLevel: 'strict';
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
}: Parameters<MermaidRenderSchedulerOptions['render']>[0]): Promise<string> {
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
