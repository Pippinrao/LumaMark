import { MathJaxNewcmFont as packageNewcmFont } from '@mathjax/mathjax-newcm-font/mjs/chtml.js';
import { MathJaxNewcmFont as fileNewcmFont } from '../../../../node_modules/@mathjax/mathjax-newcm-font/mjs/chtml.js';

export const newcmDynamicModules = import.meta.glob(
  '../../../../node_modules/@mathjax/mathjax-newcm-font/mjs/chtml/dynamic/*.js',
  { eager: true },
);

type NewcmDynamicFile = {
  failed: boolean;
  promise: Promise<unknown> | null;
  setup: (font: unknown) => void;
};

type NewcmFontClass = {
  dynamicFiles: Record<string, NewcmDynamicFile>;
};

function fontDynamicFiles(fontClass: unknown): Record<string, NewcmDynamicFile> {
  return (fontClass as NewcmFontClass).dynamicFiles;
}

export function adoptNewcmDynamicFiles(from: unknown, to: unknown): void {
  if (from === to) {
    return;
  }

  const fromFiles = fontDynamicFiles(from);
  const toFiles = fontDynamicFiles(to);
  for (const [name, source] of Object.entries(fromFiles)) {
    const target = toFiles[name];
    if (!target) {
      continue;
    }
    target.failed = source.failed;
    target.promise = source.promise;
    target.setup = source.setup;
  }
}

function keepLoadedNewcmDynamicFiles(fontClass: unknown): void {
  for (const file of Object.values(fontDynamicFiles(fontClass))) {
    const apply = file.setup;
    file.setup = (font) => {
      apply(font);
      file.failed = false;
    };
  }
}

adoptNewcmDynamicFiles(fileNewcmFont, packageNewcmFont);
adoptNewcmDynamicFiles(packageNewcmFont, fileNewcmFont);
keepLoadedNewcmDynamicFiles(packageNewcmFont);
keepLoadedNewcmDynamicFiles(fileNewcmFont);

export const MathJaxNewcmFont = packageNewcmFont;
