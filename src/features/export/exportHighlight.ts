import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
} as const;

let registered = false;

function ensureLanguages(): void {
  if (registered) {
    return;
  }

  for (const [name, language] of Object.entries(LANGUAGES)) {
    hljs.registerLanguage(name, language);
  }
  registered = true;
}

/**
 * Returns highlighted markup without a wrapping element, or null when the
 * language is unknown. Unknown languages stay plain and are escaped by the
 * caller.
 */
export function highlightCode(code: string, language: string): string | null {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  ensureLanguages();
  if (!hljs.getLanguage(normalized)) {
    return null;
  }

  try {
    return hljs.highlight(code, {
      ignoreIllegals: true,
      language: normalized,
    }).value;
  } catch {
    return null;
  }
}
