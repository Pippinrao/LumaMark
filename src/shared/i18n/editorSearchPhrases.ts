import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import type { AppLanguage } from './index';

const phraseKeys = {
  Find: 'editor.search.find',
  Replace: 'editor.search.replace',
  next: 'editor.search.next',
  previous: 'editor.search.previous',
  all: 'editor.search.all',
  'match case': 'editor.search.matchCase',
  regexp: 'editor.search.regexp',
  'by word': 'editor.search.byWord',
  replace: 'editor.search.replaceOne',
  'replace all': 'editor.search.replaceAll',
  close: 'editor.search.close',
  'Go to line': 'editor.search.goToLine',
  go: 'editor.search.go',
  'current match': 'editor.search.currentMatch',
  'on line': 'editor.search.onLine',
  'replaced match on line $': 'editor.search.replacedMatchOnLine',
  'replaced $ matches': 'editor.search.replacedMatches',
} as const;

type EditorSearchPhraseKey = (typeof phraseKeys)[keyof typeof phraseKeys];

const translations: Record<AppLanguage, Record<EditorSearchPhraseKey, string>> = {
  en,
  'zh-CN': zhCN,
};

export function getEditorSearchPhrases(
  language: AppLanguage,
): Record<string, string> {
  const languageTranslations = translations[language];

  return Object.fromEntries(
    Object.entries(phraseKeys).map(([phrase, translationKey]) => [
      phrase,
      languageTranslations[translationKey],
    ]),
  );
}
