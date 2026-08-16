import { MathJaxNewcmFont } from '@mathjax/mathjax-newcm-font/js/chtml.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import type { LiteElement } from '@mathjax/src/js/adaptors/lite/Element.js';
import type { LiteDocument } from '@mathjax/src/js/adaptors/lite/Document.js';
import type { LiteText } from '@mathjax/src/js/adaptors/lite/Text.js';
import type { MathItem } from '@mathjax/src/js/core/MathItem.js';
import type { InputJax } from '@mathjax/src/js/core/InputJax.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { HTMLMathItem } from '@mathjax/src/js/handlers/html/HTMLMathItem.js';
import '@mathjax/src/js/input/tex/ams/AmsConfiguration.js';
import '@mathjax/src/js/input/tex/begingroup/BegingroupConfiguration.js';
import '@mathjax/src/js/input/tex/configmacros/ConfigMacrosConfiguration.js';
import '@mathjax/src/js/input/tex/mhchem/MhchemConfiguration.js';
import '@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js';
import '@mathjax/src/js/input/tex/physics/PhysicsConfiguration.js';
import '@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { CHTML } from '@mathjax/src/js/output/chtml.js';
import { SafeHandler } from '@mathjax/src/js/ui/safe/SafeHandler.js';
import './mathjaxLocalModuleLoader';
import { rewriteNewcmFontUrls } from './mathjaxFontAssets';
import type {
  MathDocumentRenderRequest,
  MathDocumentRenderResult,
} from './mathWorkerProtocol';

export const MATHJAX_TEX_PACKAGE_WHITELIST = [
  'base',
  'ams',
  'newcommand',
  'textmacros',
  'configmacros',
  'begingroup',
  'mhchem',
  'physics',
] as const;

export const MATHJAX_FORBIDDEN_TEX_PACKAGES = [
  'require',
  'autoload',
  'setoptions',
  'html',
  'texhtml',
] as const;

export const MATHJAX_SAFE_OPTIONS = {
  allow: {
    URLs: 'safe',
    classes: 'none',
    cssIDs: 'safe',
    styles: 'none',
  },
  idPattern: /^mjx-eqn:\d+$/u,
  safeProtocols: {
    data: false,
    file: false,
    http: false,
    https: false,
    javascript: false,
  },
} as const;

const MAX_FORMULA_COUNT = 1_000;
const MAX_FORMULA_SOURCE_LENGTH = 10 * 1024;
const MAX_DOCUMENT_SOURCE_LENGTH = 1024 * 1024;

const adaptor = liteAdaptor();
SafeHandler(RegisterHTMLHandler(adaptor));

export async function renderMathDocument(
  request: MathDocumentRenderRequest,
): Promise<MathDocumentRenderResult> {
  validateRequest(request);
  const packages = MATHJAX_TEX_PACKAGE_WHITELIST.filter(
    (name) => name !== 'physics' || request.preferences.physics,
  );
  const input = new TeX({
    maxBuffer: 10 * 1024,
    maxMacros: 1_000,
    maxTemplateSubtitutions: 10_000,
    packages,
    tags: request.preferences.numbering,
    useLabelIds: false,
  });
  const output = new CHTML({
    adaptiveCSS: true,
    fontData: MathJaxNewcmFont,
    fontURL: '/mathjax/fonts',
  });
  const document = mathjax.document('', {
    InputJax: input,
    OutputJax: output,
    safeOptions: MATHJAX_SAFE_OPTIONS,
  });
  const body = adaptor.body(document.document as LiteDocument);
  const items: Array<HTMLMathItem<LiteElement, LiteText, LiteDocument>> = [];
  const labelsByFormula = new Map<string, string[]>();

  input.postFilters.add((value: unknown) => {
    const { math } = value as {
      math: MathItem<LiteElement, LiteText, LiteDocument>;
    };
    labelsByFormula.set(
      request.formulas[math.start.n ?? -1]?.id ?? '',
      Object.keys(input.parseOptions.tags.labels),
    );
  }, 10);

  for (const [index, formula] of request.formulas.entries()) {
    const placeholder = adaptor.append(body, adaptor.text('')) as LiteText;
    const item = new HTMLMathItem<LiteElement, LiteText, LiteDocument>(
      formula.source,
      input as unknown as InputJax<LiteElement, LiteText, LiteDocument>,
      formula.display,
      { n: index, node: placeholder },
      { n: 0, node: placeholder },
    );
    item.setMetrics(
      request.layoutMetrics.em,
      request.layoutMetrics.ex,
      request.layoutMetrics.containerWidth,
      1,
    );
    document.math.push(item);
    items.push(item);
  }

  await document.renderPromise();
  const tagPrefix = documentTagPrefix(request.documentId);
  for (const item of items) {
    scopeEquationFragments(item.typesetRoot, tagPrefix);
  }

  const formulas = items.map((item, index) => {
    const formula = request.formulas[index];
    const labels = labelsByFormula.get(formula.id) ?? [];
    const errorNode = adaptor.tags(item.typesetRoot, 'mjx-merror')[0];
    return errorNode
      ? {
          error:
            adaptor.getAttribute(errorNode, 'data-mjx-error') ||
            adaptor.textContent(errorNode),
          id: formula.id,
          labels,
          sourceFingerprint: formulaFingerprint(formula),
        }
      : {
          chtml: adaptor.outerHTML(item.typesetRoot),
          id: formula.id,
          labels,
          sourceFingerprint: formulaFingerprint(formula),
        };
  });
  const documentLabels = Object.fromEntries(
    formulas.flatMap((formula) =>
      formula.labels.map((label) => [label, { formulaId: formula.id }]),
    ),
  );

  return {
    documentId: request.documentId,
    documentLabels,
    formulas,
    generation: request.generation,
    stylesheet: rewriteNewcmFontUrls(
      adaptor.textContent(
        output.styleSheet(document) as unknown as LiteElement,
      ),
    ),
  };
}

function documentTagPrefix(documentId: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < documentId.length; index += 1) {
    hash ^= documentId.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `lm-math-${(hash >>> 0).toString(36)}-`;
}

function scopeEquationFragments(
  root: LiteElement,
  prefix: string,
): void {
  const pending = [root];
  while (pending.length > 0) {
    const element = pending.pop();
    if (!element) {
      continue;
    }

    const id = adaptor.getAttribute(element, 'id');
    if (id?.startsWith('mjx-eqn:')) {
      adaptor.setAttribute(element, 'id', `${prefix}${id}`);
    }

    const href = adaptor.getAttribute(element, 'href');
    if (href?.startsWith('#')) {
      const fragment = decodeURIComponent(href.slice(1));
      if (fragment.startsWith('mjx-eqn:')) {
        adaptor.setAttribute(
          element,
          'href',
          `#${encodeURIComponent(`${prefix}${fragment}`)}`,
        );
      }
    }

    for (const child of adaptor.childNodes(element)) {
      if (adaptor.kind(child) !== '#text' && adaptor.kind(child) !== '#comment') {
        pending.push(child as LiteElement);
      }
    }
  }
}

function formulaFingerprint(formula: {
  display: boolean;
  source: string;
}): string {
  return JSON.stringify([formula.display, formula.source]);
}

function validateRequest(request: MathDocumentRenderRequest): void {
  if (request.formulas.length > MAX_FORMULA_COUNT) {
    throw new RangeError(`Math document exceeds ${MAX_FORMULA_COUNT} formulas.`);
  }

  let totalLength = 0;
  for (const formula of request.formulas) {
    if (formula.source.length > MAX_FORMULA_SOURCE_LENGTH) {
      throw new RangeError(
        `Math formula exceeds ${MAX_FORMULA_SOURCE_LENGTH} characters.`,
      );
    }
    totalLength += formula.source.length;
  }
  if (totalLength > MAX_DOCUMENT_SOURCE_LENGTH) {
    throw new RangeError(
      `Math document exceeds ${MAX_DOCUMENT_SOURCE_LENGTH} characters.`,
    );
  }
}
