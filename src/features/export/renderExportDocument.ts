import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import type { Env, Token } from 'markdown-it';
import { EXPORT_DOCUMENT_CSS } from './exportStyles';
import { exportMathPlugin, type ExportMathEnv } from './exportMathPlugin';
import { highlightCode } from './exportHighlight';
import type {
  ExportDiagramFormat,
  ExportMathFormula,
  ExportRenderDeps,
  ExportRenderInput,
  ExportRenderResult,
  ExportWarning,
} from './exportTypes';

const DIAGRAM_CONCURRENCY = 2;
const IMAGE_CONCURRENCY = 4;
const TASK_CHECKBOX_PATTERN =
  /^<input class="task-list-item-checkbox"(?: checked="")?(?: disabled="")? type="checkbox">$/u;

type DiagramResult =
  | { kind: 'error'; code: string; line?: number; message: string }
  | { kind: 'svg'; svg: string };

type ImageResult =
  | { dataUri: string; kind: 'dataUri'; mimeType: string }
  | { kind: 'error'; message: string; reason: ExportWarning['code'] };

type DiagramRecord = {
  format: ExportDiagramFormat;
  id: string;
  source: string;
  token: Token;
};

type ExportEnv = Env &
  ExportMathEnv & {
    exportDiagramMessages?: { diagramFailed: string };
    exportDiagramResults?: Map<string, DiagramResult>;
    exportImageMessages?: { imageUnavailable: string };
    exportImageResults?: Map<string, ImageResult>;
    exportMathStylesheet?: string;
  };

export async function renderExportDocument(
  input: ExportRenderInput,
  providedDeps?: ExportRenderDeps,
): Promise<ExportRenderResult> {
  const deps = providedDeps ?? (await loadDefaultDeps());
  const env: ExportEnv = {
    exportDiagramMessages: { diagramFailed: input.messages.diagramFailed },
    exportImageMessages: { imageUnavailable: input.messages.imageUnavailable },
    exportMathMessages: { mathFailed: input.messages.mathFailed },
  };
  const md = createMarkdown(input);
  const tokens = md.parse(input.markdown, env);
  const formulas = env.exportMathFormulas ?? [];
  const diagrams = collectDiagrams(tokens, input.plantumlEnabled);
  const imageSources = collectImageSources(tokens);
  const warnings: ExportWarning[] = [];

  const math = await renderMath(deps, formulas, input, warnings);
  env.exportMathById = math.byId;
  env.exportMathStylesheet = math.stylesheet;

  const diagramResults = new Map<string, DiagramResult>();
  await mapWithConcurrency(diagrams, DIAGRAM_CONCURRENCY, async (diagram) => {
    const result = await deps.renderDiagram(diagram.source, diagram.format);
    diagramResults.set(diagram.id, result);
    if (result.kind === 'error') {
      warnings.push({
        code: diagramWarningCode(result.code),
        format: diagram.format,
        line: result.line,
        message: result.message,
      });
    }
  });
  env.exportDiagramResults = diagramResults;

  const imageResults = new Map<string, ImageResult>();
  await mapWithConcurrency(imageSources, IMAGE_CONCURRENCY, async (source) => {
    const result = await deps.embedImage(source, input.documentPath);
    imageResults.set(source, result);
    if (result.kind === 'error') {
      warnings.push({ code: result.reason, message: result.message, source });
    }
  });
  env.exportImageResults = imageResults;

  const body = md.renderer.render(tokens, md.options, env);
  const mathStyles = env.exportMathStylesheet
    ? `<style data-lm-export-math>${env.exportMathStylesheet}</style>\n`
    : '';
  const title = resolveTitle(input, tokens);
  const html = buildHtmlDocument({
    body: `${mathStyles}<main class="lm-export-document">${body}</main>`,
    language: input.language,
    title,
  });

  return {
    bytes: byteLength(html),
    html,
    title,
    warnings,
  };
}

function createMarkdown(input: ExportRenderInput): ReturnType<typeof MarkdownIt> {
  const md = new MarkdownIt({
    breaks: false,
    html: false,
    linkify: false,
    typographer: false,
  });
  md.use(taskLists, { enabled: false });
  exportMathPlugin(md, { syntaxMode: input.math.syntaxMode });

  const defaultValidateLink = md.validateLink.bind(md);
  md.validateLink = (url: string) => {
    if (/^data:image\//iu.test(url)) {
      return true;
    }
    return defaultValidateLink(url);
  };

  md.renderer.rules.html_inline = (tokens, index) => {
    const content = tokens[index]?.content ?? '';
    return TASK_CHECKBOX_PATTERN.test(content)
      ? content
      : md.utils.escapeHtml(content);
  };

  const defaultLinkOpen = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, index, options, renderEnv, self) => {
    const token = tokens[index]!;
    const href = attrString(token, 'href');
    if (href && /^\s*data:/iu.test(href)) {
      token.attrSet('href', '');
    }
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, renderEnv, self)
      : self.renderToken(tokens, index, options);
  };

  md.renderer.rules.fence = (tokens, index, _options, renderEnv) => {
    const token = tokens[index]!;
    const language = firstInfoWord(token.info);
    const diagramId = (token.meta as { exportDiagramId?: string } | undefined)
      ?.exportDiagramId;

    if (diagramId) {
      const result = (renderEnv as ExportEnv).exportDiagramResults?.get(
        diagramId,
      );
      if (result?.kind === 'svg') {
        return `<figure class="lm-export-diagram">${result.svg}</figure>\n`;
      }
      const message = input.messages.diagramFailed;
      return `<div class="lm-export-diagram-error"><p>${md.utils.escapeHtml(
        message,
      )}</p><pre><code>${md.utils.escapeHtml(token.content)}</code></pre></div>\n`;
    }

    const highlighted = language ? highlightCode(token.content, language) : null;
    const code = highlighted ?? md.utils.escapeHtml(token.content);
    const className = language
      ? ` class="hljs language-${md.utils.escapeHtml(language)}"`
      : ' class="hljs"';
    return `<pre><code${className}>${code}</code></pre>\n`;
  };

  md.renderer.rules.image = (tokens, index, _options, renderEnv) => {
    const token = tokens[index]!;
    const source = attrString(token, 'src');
    const alt = token.content || attrString(token, 'alt');
    const title = attrString(token, 'title');
    const embedded = (renderEnv as ExportEnv).exportImageResults?.get(source);

    if (!embedded || embedded.kind !== 'dataUri') {
      const label = alt || input.messages.imageUnavailable;
      return `<span class="lm-export-image-missing" role="img" aria-label="${md.utils.escapeHtml(
        label,
      )}">${md.utils.escapeHtml(label)}</span>`;
    }

    const titleAttribute = title
      ? ` title="${md.utils.escapeHtml(title)}"`
      : '';
    return `<img src="${embedded.dataUri}" alt="${md.utils.escapeHtml(
      alt,
    )}"${titleAttribute}>`;
  };

  return md;
}

function collectDiagrams(
  tokens: Token[],
  plantumlEnabled: boolean,
): DiagramRecord[] {
  const diagrams: DiagramRecord[] = [];
  for (const token of tokens) {
    if (token.type !== 'fence') {
      continue;
    }
    const language = firstInfoWord(token.info);
    if (language !== 'mermaid' && language !== 'plantuml') {
      continue;
    }
    if (language === 'plantuml' && !plantumlEnabled) {
      continue;
    }
    const id = `diagram:${diagrams.length}`;
    token.meta = { ...(token.meta as object | undefined), exportDiagramId: id };
    diagrams.push({ format: language, id, source: token.content, token });
  }
  return diagrams;
}

function attrString(token: Token, name: string): string {
  const value = token.attrGet(name);
  if (typeof value === 'string') {
    return value;
  }
  return typeof value === 'number' ? String(value) : '';
}

function collectImageSources(tokens: Token[]): string[] {
  const sources = new Set<string>();
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.children) {
      continue;
    }
    for (const child of token.children) {
      if (child.type !== 'image') {
        continue;
      }
      const source = attrString(child, 'src');
      if (source) {
        sources.add(source);
      }
    }
  }
  return Array.from(sources);
}

function firstInfoWord(info: string): string {
  return info.trim().split(/\s+/u, 1)[0]?.toLowerCase() ?? '';
}

type DiagramWarningCode =
  | 'export.diagram_failed'
  | 'export.diagram_timeout'
  | 'export.diagram_unavailable';

function diagramWarningCode(code: string): DiagramWarningCode {
  if (code === 'renderer.timeout') {
    return 'export.diagram_timeout';
  }
  if (code === 'renderer.unavailable') {
    return 'export.diagram_unavailable';
  }
  return 'export.diagram_failed';
}

async function renderMath(
  deps: ExportRenderDeps,
  formulas: readonly ExportMathFormula[],
  input: ExportRenderInput,
  warnings: ExportWarning[],
): Promise<{ byId: Map<string, string>; stylesheet: string }> {
  if (formulas.length === 0) {
    return { byId: new Map(), stylesheet: '' };
  }

  const result = await deps.renderMath(formulas, input.math);
  if (result.kind === 'failed') {
    warnings.push({
      code: 'export.math_failed',
      message: result.message,
      source: formulas[0]?.source ?? '',
    });
    return { byId: new Map(), stylesheet: '' };
  }

  return {
    byId: new Map(result.formulas),
    stylesheet: result.stylesheet,
  };
}

function resolveTitle(input: ExportRenderInput, tokens: Token[]): string {
  if (input.title?.trim()) {
    return input.title.trim();
  }

  if (input.documentPath) {
    const normalized = input.documentPath.replace(/\\/gu, '/');
    const fileName = normalized.slice(normalized.lastIndexOf('/') + 1);
    const stem = fileName.replace(/\.[^.]+$/u, '').trim();
    if (stem) {
      return stem;
    }
  }

  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading_open' || token.tag !== 'h1') {
      continue;
    }
    const inline = tokens[index + 1];
    if (inline?.type === 'inline') {
      const text = inlineText(inline).trim();
      if (text) {
        return text;
      }
    }
  }

  return 'LumaMark Export';
}

function inlineText(token: Token): string {
  if (!token.children) {
    return token.content;
  }
  return token.children
    .map((child) => {
      if (child.type === 'text' || child.type === 'code_inline') {
        return child.content;
      }
      if (child.type === 'image') {
        return child.content;
      }
      return '';
    })
    .join('');
}

function buildHtmlDocument({
  body,
  language,
  title,
}: {
  body: string;
  language: string;
  title: string;
}): string {
  const escapedTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'">
<title>${escapedTitle}</title>
<style>${EXPORT_DOCUMENT_CSS}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= items.length) {
          return;
        }
        await work(items[index]!);
      }
    },
  );
  await Promise.all(workers);
}

async function loadDefaultDeps(): Promise<ExportRenderDeps> {
  const [{ renderMathFormulas }, { renderExportDiagram }, { embedImageForExport }] =
    await Promise.all([
      import('./exportMath'),
      import('./exportDiagrams'),
      import('./exportImages'),
    ]);

  return {
    embedImage: embedImageForExport,
    renderDiagram: renderExportDiagram,
    renderMath: renderMathFormulas,
  };
}
