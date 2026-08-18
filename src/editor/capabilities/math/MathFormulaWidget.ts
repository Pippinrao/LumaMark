import { EditorSelection } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { i18n } from '../../../shared/i18n';
import {
  BlockWidgetGeometryCache,
  BlockWidgetGeometryTracker,
  blockWidgetGeometryKey,
} from '../blockWidgetGeometry';

const MATH_BLOCK_HEIGHT_ESTIMATE = 48;
const SCOPED_EQUATION_ID = /^lm-math-[a-z0-9]+-mjx-eqn:\d+$/u;
const SCOPED_EQUATION_HREF =
  /^#lm-math-[a-z0-9]+-mjx-eqn%3a\d+$/iu;

export type MathFormulaWidgetOptions = {
  readonly activationOffset: number;
  readonly chtml: string;
  readonly display: boolean;
  readonly error: string | null;
  readonly formulaLength: number;
  readonly onEquationRefClick?: (href: string) => boolean;
  readonly renderedAfterSource: boolean;
  readonly source: string;
};

export function mathFormulaGeometryKey(
  options: Pick<
    MathFormulaWidgetOptions,
    'chtml' | 'error' | 'source'
  >,
): string {
  return blockWidgetGeometryKey('math', [
    options.source,
    options.chtml,
    options.error ?? '',
  ]);
}

export class MathFormulaWidget extends WidgetType {
  private readonly geometry: BlockWidgetGeometryTracker | null;

  constructor(
    private readonly options: MathFormulaWidgetOptions,
    geometryCache = new BlockWidgetGeometryCache(),
  ) {
    super();
    this.geometry = options.display
      ? new BlockWidgetGeometryTracker(
          geometryCache,
          mathFormulaGeometryKey(options),
          MATH_BLOCK_HEIGHT_ESTIMATE,
        )
      : null;
  }

  eq(other: MathFormulaWidget): boolean {
    return (
      other.options.activationOffset === this.options.activationOffset &&
      other.options.chtml === this.options.chtml &&
      other.options.display === this.options.display &&
      other.options.error === this.options.error &&
      other.options.formulaLength === this.options.formulaLength &&
      other.options.renderedAfterSource === this.options.renderedAfterSource &&
      other.options.source === this.options.source
    );
  }

  get estimatedHeight(): number {
    return this.geometry?.estimatedHeight ?? -1;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement(this.options.display ? 'div' : 'span');
    root.className = this.options.display
      ? 'lm-math-render lm-math-block-render'
      : 'lm-math-render lm-math-inline-render';
    root.setAttribute('aria-label', this.options.source);
    root.setAttribute('role', 'math');
    root.tabIndex = 0;

    const rendered = safeMathJaxContainer(this.options.chtml);
    if (rendered) {
      root.appendChild(rendered);
    } else if (this.options.source.trim() === '' && !this.options.error) {
      const placeholder = document.createElement(
        this.options.display ? 'div' : 'span',
      );
      placeholder.className = 'lm-math-empty-placeholder';
      placeholder.dataset.lmMathEmpty = '';
      placeholder.textContent = i18n.t('math.emptyFormula');
      root.appendChild(placeholder);
    }

    if (this.options.error) {
      const error = document.createElement(this.options.display ? 'div' : 'span');
      error.className = 'lm-math-render-error';
      error.setAttribute('role', 'status');
      error.textContent = this.options.error;
      root.appendChild(error);
    }

    root.addEventListener('click', (event) => {
      const href = equationHrefFromEvent(event);
      if (href && this.options.onEquationRefClick?.(href)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      const widgetPosition = view.posAtDOM(root, 0);
      const formulaFrom = this.options.renderedAfterSource
        ? widgetPosition - this.options.formulaLength
        : widgetPosition;
      const position = Math.max(
        0,
        Math.min(
          view.state.doc.length,
          formulaFrom + this.options.activationOffset,
        ),
      );
      view.dispatch({ selection: EditorSelection.cursor(position) });
      view.focus();
    });

    this.geometry?.mount(view, root);
    return root;
  }

  destroy(dom: HTMLElement): void {
    this.geometry?.unmount(dom);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

export class MathFormulaErrorWidget extends WidgetType {
  constructor(
    private readonly display: boolean,
    private readonly error: string,
  ) {
    super();
  }

  eq(other: MathFormulaErrorWidget): boolean {
    return other.display === this.display && other.error === this.error;
  }

  toDOM(): HTMLElement {
    const error = document.createElement(this.display ? 'div' : 'span');
    error.className = 'lm-math-render-error lm-math-source-error';
    error.setAttribute('role', 'status');
    error.textContent = this.error;
    return error;
  }
}

function safeMathJaxContainer(chtml: string): Element | null {
  const template = document.createElement('template');
  template.innerHTML = chtml;
  const root = template.content.firstElementChild;
  if (
    !root ||
    root.localName !== 'mjx-container' ||
    root.nextElementSibling
  ) {
    return null;
  }

  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (isForbiddenElement(element.localName)) {
      element.remove();
      continue;
    }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on') ||
        name === 'autofocus' ||
        name === 'contenteditable' ||
        name === 'download' ||
        name === 'name' ||
        name === 'nonce' ||
        name === 'ping' ||
        name === 'popover' ||
        name === 'referrerpolicy' ||
        name === 'src' ||
        name === 'srcset' ||
        name === 'tabindex' ||
        name === 'target' ||
        name.startsWith('form') ||
        (name.endsWith(':href') && name !== 'href') ||
        (name === 'href' && !SCOPED_EQUATION_HREF.test(attribute.value)) ||
        (name === 'id' && !SCOPED_EQUATION_ID.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      } else if (name === 'class') {
        sanitizeMathJaxClasses(element);
      } else if (name === 'style') {
        sanitizeMathJaxInlineStyle(element as HTMLElement);
      }
    }
  }

  return root;
}

function isForbiddenElement(name: string): boolean {
  return name !== 'a' && !name.startsWith('mjx-');
}

function equationHrefFromEvent(event: Event): string | null {
  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest('a[href]');
  const href = anchor?.getAttribute('href');
  return href && SCOPED_EQUATION_HREF.test(href) ? href : null;
}

function sanitizeMathJaxClasses(element: Element): void {
  const safeClasses = [...element.classList].filter((className) =>
    /^(?:MathJax|MJX-[A-Za-z0-9-]+|NCM-[A-Za-z0-9-]+|TEX-[A-Za-z0-9-]+|mjx-[A-Za-z0-9-]+)$/u.test(
      className,
    ),
  );
  if (safeClasses.length === 0) {
    element.removeAttribute('class');
  } else {
    element.setAttribute('class', safeClasses.join(' '));
  }
}

function sanitizeMathJaxInlineStyle(element: HTMLElement): void {
  const unsafeProperty = /^(?:behavior$|-moz-binding$)/u;
  for (const property of [...element.style]) {
    const value = element.style.getPropertyValue(property);
    if (
      unsafeProperty.test(property) ||
      /(?:expression|url)\s*\(/iu.test(value) ||
      (/^position$/u.test(property) && /^(?:fixed|sticky)$/iu.test(value.trim())) ||
      /^z-index$/u.test(property)
    ) {
      element.style.removeProperty(property);
    }
  }

  if (element.style.length === 0) {
    element.removeAttribute('style');
  }
}
