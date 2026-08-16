import type { PlantumlRenderContext } from './plantumlRenderScheduler';
import { renderPlantuml } from './plantumlEngine';

export async function renderWithPlantuml({
  dark,
  source,
}: PlantumlRenderContext): Promise<string> {
  const svg = await renderPlantuml(source, { dark });
  const DOMPurify = (await import('dompurify')).default;

  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
}
