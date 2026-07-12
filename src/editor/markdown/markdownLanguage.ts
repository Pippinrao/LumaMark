import { markdown, markdownLanguage as gfmMarkdownLanguage } from '@codemirror/lang-markdown';
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from '@codemirror/lang-javascript';
import type { Language, LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { tags } from '@lezer/highlight';

export function markdownLanguage(): Extension {
  return markdown({
    base: gfmMarkdownLanguage,
    codeLanguages: codeLanguageForInfo,
  });
}

function codeLanguageForInfo(info: string): Language | LanguageDescription | null {
  const languageName = info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';

  switch (languageName) {
    case 'js':
    case 'javascript':
      return javascriptLanguage;
    case 'jsx':
      return jsxLanguage;
    case 'ts':
    case 'typescript':
      return typescriptLanguage;
    case 'tsx':
      return tsxLanguage;
    default:
      return (
        languages.find((language) =>
          language.alias.some((alias) => alias.toLowerCase() === languageName),
        ) ??
        languages.find((language) => language.name.toLowerCase() === languageName) ??
        null
      );
  }
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: 'lm-code-token-keyword' },
  { tag: tags.definitionKeyword, class: 'lm-code-token-keyword' },
  { tag: tags.controlKeyword, class: 'lm-code-token-keyword' },
  { tag: tags.operatorKeyword, class: 'lm-code-token-keyword' },
  { tag: tags.atom, class: 'lm-code-token-atom' },
  { tag: tags.bool, class: 'lm-code-token-atom' },
  { tag: tags.number, class: 'lm-code-token-number' },
  { tag: tags.string, class: 'lm-code-token-string' },
  { tag: tags.variableName, class: 'lm-code-token-variable' },
  { tag: tags.definition(tags.variableName), class: 'lm-code-token-definition' },
  { tag: tags.function(tags.variableName), class: 'lm-code-token-function' },
  { tag: tags.typeName, class: 'lm-code-token-type' },
  { tag: tags.propertyName, class: 'lm-code-token-property' },
  { tag: tags.comment, class: 'lm-code-token-comment' },
  { tag: tags.operator, class: 'lm-code-token-operator' },
  { tag: tags.punctuation, class: 'lm-code-token-punctuation' },
  { tag: tags.meta, class: 'lm-code-token-meta' },
  { tag: tags.heading, class: 'lm-table-token-heading' },
  { tag: tags.strong, class: 'lm-table-token-strong' },
  { tag: tags.emphasis, class: 'lm-table-token-emphasis' },
  { tag: tags.strikethrough, class: 'lm-table-token-strikethrough' },
  { tag: tags.monospace, class: 'lm-table-token-code' },
  { tag: tags.link, class: 'lm-table-token-link' },
  { tag: tags.processingInstruction, class: 'lm-table-token-mark' },
]);

export function markdownSyntaxHighlighting(): Extension {
  return syntaxHighlighting(markdownHighlightStyle);
}
