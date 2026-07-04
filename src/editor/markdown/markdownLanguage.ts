import { markdown } from '@codemirror/lang-markdown';
import type { Extension } from '@codemirror/state';

export function markdownLanguage(): Extension {
  return markdown();
}
