/** @param {import('./types.ts').DiagramInput} input
 * @param {{ loadFailed: string, noSvg: string }} messages
 * @returns {Promise<import('./types.ts').RenderResult>} */
export async function renderDiagram({ source, format }, messages) {
  try {
    let svg;
    if (format === 'mermaid') {
      const url = '/mermaid/mermaid.esm.min.mjs';
      const mermaid = (await import(url)).default;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', htmlLabels: false, flowchart: { htmlLabels: false } });
      await mermaid.parse(source);
      svg = (await mermaid.render(`lm-${crypto.randomUUID()}`, source)).svg;
    } else {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/plantuml/viz-global.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error(messages.loadFailed));
        document.head.appendChild(script);
      });
      const url = '/plantuml/plantuml.js';
      const engine = await import(url);
      svg = await new Promise((resolve, reject) => engine.renderToString(source.split(/\r\n|\r|\n/), resolve, (/** @type {string} */ message) => reject(new Error(message))));
      // The official engine can return a rendered error page through onSuccess.
      if (svg.includes('Syntax Error?') && /\[From (?:textarea|string) \(line \d+\)/.test(svg)) {
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        const line = Number(svg.match(/\[From (?:textarea|string) \(line (\d+)\)/)?.[1]);
        return { ok: false, code: 'diagram.invalid', message: Array.from(doc.querySelectorAll('text')).map((node) => node.textContent).join('\n'), line: line || undefined };
      }
    }
    const url = '/dompurify/purify.es.mjs';
    const purify = (await import(url)).default;
    const safeSvg = purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    if (!safeSvg.includes('<svg')) throw new Error(messages.noSvg);
    return { ok: true, svg: safeSvg };
  } catch (error) {
    const detail = /** @type {{ message?: string, hash?: { loc?: { first_line?: number } } }} */ (error);
    return { ok: false, code: 'diagram.invalid', message: detail.message ?? String(error), line: detail.hash?.loc?.first_line };
  }
}
