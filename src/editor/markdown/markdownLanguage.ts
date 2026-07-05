import { markdown, markdownLanguage as gfmMarkdownLanguage } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';

export function markdownLanguage(): Extension {
  return markdown({
    base: gfmMarkdownLanguage,
  });
}
