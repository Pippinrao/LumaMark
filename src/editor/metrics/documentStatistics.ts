import { Text } from '@codemirror/state';

export type DocumentStatistics = {
  characters: number;
  lines: number;
  words: number;
};

const letterOrNumberPattern = /\p{L}|\p{N}/u;
const STATISTICS_SLICE_BUDGET_MS = 8;

export function getDocumentStatisticsFromText(doc: Text): DocumentStatistics {
  if (doc.length === 0) {
    return { characters: 0, lines: 0, words: 0 };
  }

  let characters = 0;
  let words = 0;
  const lines = doc.iterLines();

  while (!lines.next().done) {
    const counted = countLineStatistics(lines.value);
    characters += counted.characters;
    words += counted.words;
  }

  return {
    characters,
    lines: doc.lines,
    words,
  };
}

export function getDocumentStatistics(text: string): DocumentStatistics {
  if (!text) {
    return { characters: 0, lines: 0, words: 0 };
  }

  return getDocumentStatisticsFromText(Text.of(text.split('\n')));
}

export function scheduleDocumentStatisticsFromText(
  doc: Text,
  onComplete: (statistics: DocumentStatistics) => void,
): { cancel: () => void } {
  let cancelled = false;

  if (doc.length === 0) {
    onComplete({ characters: 0, lines: 0, words: 0 });
    return {
      cancel() {
        cancelled = true;
      },
    };
  }

  const lines = doc.iterLines();
  let characters = 0;
  let words = 0;

  const step = () => {
    if (cancelled) {
      return;
    }

    const deadline = performance.now() + STATISTICS_SLICE_BUDGET_MS;
    while (performance.now() < deadline) {
      if (lines.next().done) {
        onComplete({
          characters,
          lines: doc.lines,
          words,
        });
        return;
      }

      const counted = countLineStatistics(lines.value);
      characters += counted.characters;
      words += counted.words;
    }

    scheduleStatisticsSlice(step);
  };

  scheduleStatisticsSlice(step);

  return {
    cancel() {
      cancelled = true;
    },
  };
}

function scheduleStatisticsSlice(step: () => void): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(step, { timeout: 32 });
    return;
  }

  setTimeout(step, 0);
}

function countLineStatistics(line: string): {
  characters: number;
  words: number;
} {
  let characters = 0;
  let words = 0;
  let index = 0;

  while (index < line.length) {
    const unit = line.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < line.length) {
      const codePoint = line.codePointAt(index) ?? unit;
      characters += 1;
      if (isHanCodePoint(codePoint)) {
        words += 1;
      }
      index += 2;
      continue;
    }

    if (isWhitespaceCodeUnit(unit)) {
      index += 1;
      continue;
    }

    characters += 1;

    if (isHanCodePoint(unit)) {
      words += 1;
      index += 1;
      continue;
    }

    if (isWordCharacter(unit)) {
      words += 1;
      index += 1;
      while (index < line.length) {
        const next = line.charCodeAt(index);
        if (next >= 0xd800 && next <= 0xdbff) {
          break;
        }
        if (isWordCharacter(next) && !isHanCodePoint(next)) {
          characters += 1;
          index += 1;
          continue;
        }
        if (
          (next === 0x27 || next === 0x2019 || next === 0x2d) &&
          index + 1 < line.length &&
          isWordCharacter(line.charCodeAt(index + 1)) &&
          !isHanCodePoint(line.charCodeAt(index + 1))
        ) {
          characters += 2;
          index += 2;
          continue;
        }
        break;
      }
      continue;
    }

    index += 1;
  }

  return { characters, words };
}

function isWordCharacter(unit: number): boolean {
  if (unit < 128) {
    return (
      (unit >= 48 && unit <= 57) ||
      (unit >= 65 && unit <= 90) ||
      (unit >= 97 && unit <= 122)
    );
  }

  if (isHanCodePoint(unit)) {
    return false;
  }

  return letterOrNumberPattern.test(String.fromCharCode(unit));
}

function isHanCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2ebef) ||
    (codePoint >= 0x30000 && codePoint <= 0x3134f)
  );
}

function isWhitespaceCodeUnit(unit: number): boolean {
  if (unit <= 0x20) {
    return (
      unit === 0x09 ||
      unit === 0x0a ||
      unit === 0x0b ||
      unit === 0x0c ||
      unit === 0x0d ||
      unit === 0x20
    );
  }

  return (
    unit === 0xa0 ||
    unit === 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit === 0x2028 ||
    unit === 0x2029 ||
    unit === 0x202f ||
    unit === 0x205f ||
    unit === 0x3000 ||
    unit === 0xfeff
  );
}
