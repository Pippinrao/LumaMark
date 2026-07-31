import {
  MapMode,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
  type Transaction,
} from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';

export type SourceLineEnding = '\n' | '\r\n' | '\r';

class LineEndingValue extends RangeValue {
  override readonly startSide = 1;
  override readonly endSide = -1;
  override readonly mapMode = MapMode.TrackDel;

  constructor(readonly lineEnding: SourceLineEnding) {
    super();
  }

  override eq(other: RangeValue): boolean {
    return (
      other instanceof LineEndingValue &&
      other.lineEnding === this.lineEnding
    );
  }
}

export type DocumentSourceFormat = {
  readonly dominantLineEnding: SourceLineEnding;
  readonly hasTrailingLineEnding: boolean;
  readonly hasUtf8Bom: boolean;
  readonly lineEndingOverrides: RangeSet<LineEndingValue>;
};

export type ParsedDocumentSource = {
  readonly format: DocumentSourceFormat;
  readonly text: string;
};

const UTF8_BOM = '\uFEFF';
const LINE_ENDING_PATTERN = /\r\n|\r|\n/g;

function getDominantLineEnding(
  lineEndings: readonly SourceLineEnding[],
): SourceLineEnding {
  if (lineEndings.length === 0) {
    return '\n';
  }

  const counts = new Map<SourceLineEnding, number>();
  let dominant = lineEndings[0];
  let dominantCount = 0;

  for (const lineEnding of lineEndings) {
    const count = (counts.get(lineEnding) ?? 0) + 1;
    counts.set(lineEnding, count);
    if (count > dominantCount) {
      dominant = lineEnding;
      dominantCount = count;
    }
  }

  return dominant;
}

export function parseDocumentSource(source: string): ParsedDocumentSource {
  const hasUtf8Bom = source.startsWith(UTF8_BOM);
  const sourceWithoutBom = hasUtf8Bom ? source.slice(1) : source;
  const normalizedParts: string[] = [];
  const lineEndingPositions: number[] = [];
  const lineEndings: SourceLineEnding[] = [];
  let normalizedPosition = 0;
  let sourcePosition = 0;
  let match: RegExpExecArray | null;

  LINE_ENDING_PATTERN.lastIndex = 0;
  while ((match = LINE_ENDING_PATTERN.exec(sourceWithoutBom)) !== null) {
    const text = sourceWithoutBom.slice(sourcePosition, match.index);
    const lineEnding = match[0] as SourceLineEnding;
    normalizedParts.push(text, '\n');
    normalizedPosition += text.length;
    lineEndingPositions.push(normalizedPosition);
    lineEndings.push(lineEnding);
    normalizedPosition += 1;
    sourcePosition = match.index + lineEnding.length;
  }
  normalizedParts.push(sourceWithoutBom.slice(sourcePosition));

  const dominantLineEnding = getDominantLineEnding(lineEndings);
  const lineEndingOverrides = lineEndings.flatMap((lineEnding, index) =>
    lineEnding === dominantLineEnding
      ? []
      : [
          new LineEndingValue(lineEnding).range(
            lineEndingPositions[index],
            lineEndingPositions[index] + 1,
          ),
        ],
  );

  return {
    format: {
      dominantLineEnding,
      hasTrailingLineEnding:
        lineEndings.length > 0 && sourcePosition === sourceWithoutBom.length,
      hasUtf8Bom,
      lineEndingOverrides: RangeSet.of(lineEndingOverrides),
    },
    text: normalizedParts.join(''),
  };
}

function getLineEndingAt(
  state: EditorState,
  format: DocumentSourceFormat,
  position: number,
): SourceLineEnding | null {
  if (state.doc.sliceString(position, position + 1) !== '\n') {
    return null;
  }

  let result: SourceLineEnding | null = null;
  format.lineEndingOverrides.between(
    position,
    position + 1,
    (from, _to, value) => {
      if (from === position) {
        result = value.lineEnding;
        return false;
      }
    },
  );

  return result ?? format.dominantLineEnding;
}

function getPreviousPreservedLineEndingPosition(
  state: EditorState,
  insertedPositions: ReadonlySet<number>,
  position: number,
): number | null {
  let lineNumber = state.doc.lineAt(position).number - 1;

  while (lineNumber >= 1) {
    const lineEndingPosition = state.doc.line(lineNumber).to;
    if (!insertedPositions.has(lineEndingPosition)) {
      return lineEndingPosition;
    }
    lineNumber -= 1;
  }

  return null;
}

function getNextPreservedLineEndingPosition(
  state: EditorState,
  insertedPositions: ReadonlySet<number>,
  position: number,
): number | null {
  let lineNumber = state.doc.lineAt(position).number + 1;

  while (lineNumber < state.doc.lines) {
    const lineEndingPosition = state.doc.line(lineNumber).to;
    if (!insertedPositions.has(lineEndingPosition)) {
      return lineEndingPosition;
    }
    lineNumber += 1;
  }

  return null;
}

function getInsertedLineEndingGroups(
  transaction: Transaction,
): number[][] {
  const groups: number[][] = [];

  transaction.changes.iterChanges(
    (_fromA, _toA, fromB, _toB, inserted) => {
      const positions: number[] = [];
      const insertedText = inserted.toString();
      let position = insertedText.indexOf('\n');

      while (position !== -1) {
        positions.push(fromB + position);
        position = insertedText.indexOf('\n', position + 1);
      }

      if (positions.length > 0) {
        groups.push(positions);
      }
    },
  );

  return groups;
}

function getReplacedDocumentRanges(
  transaction: Transaction,
): readonly { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];

  transaction.changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA) {
      ranges.push({ from: fromA, to: toA });
    }
  });

  return ranges;
}

function getUpdatedDocumentRanges(
  transaction: Transaction,
): readonly { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];

  transaction.changes.iterChangedRanges(
    (_fromA, _toA, fromB, toB) => {
      ranges.push({ from: fromB, to: toB });
    },
  );

  return ranges;
}

function removeReplacedLineEndingOverrides(
  lineEndingOverrides: RangeSet<LineEndingValue>,
  replacedRanges: readonly { from: number; to: number }[],
): RangeSet<LineEndingValue> {
  let updatedOverrides = lineEndingOverrides;

  for (const range of replacedRanges) {
    updatedOverrides = updatedOverrides.update({
      filter: (from, to) =>
        from >= range.to || to <= range.from,
      filterFrom: range.from,
      filterTo: range.to,
    });
  }

  return updatedOverrides;
}

function removeInvalidLineEndingOverrides(
  lineEndingOverrides: RangeSet<LineEndingValue>,
  state: EditorState,
  updatedRanges: readonly { from: number; to: number }[],
): RangeSet<LineEndingValue> {
  let updatedOverrides = lineEndingOverrides;

  for (const range of updatedRanges) {
    updatedOverrides = updatedOverrides.update({
      filter: (from, to) =>
        to === from + 1 &&
        state.doc.sliceString(from, to) === '\n',
      filterFrom: range.from,
      filterTo: range.to,
    });
  }

  return updatedOverrides;
}

function getAffectedLineEndingRuns(
  transaction: Transaction,
  insertedGroups: readonly (readonly number[])[],
): readonly { from: number; to: number }[] {
  const seeds = new Set<number>();

  for (const group of insertedGroups) {
    group.forEach((position, index) => {
      if (index === 0 || position !== group[index - 1] + 1) {
        seeds.add(position);
      }
    });
  }

  transaction.changes.iterChangedRanges(
    (_fromA, _toA, fromB, toB) => {
      for (const position of [fromB - 1, fromB, toB - 1, toB]) {
        if (
          position >= 0 &&
          position < transaction.state.doc.length &&
          transaction.state.doc.sliceString(position, position + 1) === '\n'
        ) {
          seeds.add(position);
        }
      }
    },
  );

  const seen = new Set<string>();
  const ranges: { from: number; to: number }[] = [];

  for (const seed of seeds) {
    let from = seed;
    let to = seed + 1;

    while (
      from > 0 &&
      transaction.state.doc.sliceString(from - 1, from) === '\n'
    ) {
      from -= 1;
    }
    while (
      to < transaction.state.doc.length &&
      transaction.state.doc.sliceString(to, to + 1) === '\n'
    ) {
      to += 1;
    }

    const key = `${from}:${to}`;
    if (!seen.has(key)) {
      seen.add(key);
      ranges.push({ from, to });
    }
  }

  return ranges;
}

function getClosestPreservedLineEnding(
  state: EditorState,
  format: DocumentSourceFormat,
  insertedPositions: ReadonlySet<number>,
  group: readonly number[],
  position: number,
): SourceLineEnding {
  const previousPosition = getPreviousPreservedLineEndingPosition(
    state,
    insertedPositions,
    group[0],
  );
  const nextPosition = getNextPreservedLineEndingPosition(
    state,
    insertedPositions,
    group[group.length - 1],
  );

  if (
    previousPosition !== null &&
    (nextPosition === null ||
      position - previousPosition <= nextPosition - position)
  ) {
    return (
      getLineEndingAt(state, format, previousPosition) ??
      format.dominantLineEnding
    );
  }

  if (nextPosition !== null) {
    return (
      getLineEndingAt(state, format, nextPosition) ??
      format.dominantLineEnding
    );
  }

  return format.dominantLineEnding;
}

function disambiguateAdjacentLineEndings(
  state: EditorState,
  format: DocumentSourceFormat,
  affectedRuns: readonly { from: number; to: number }[],
): RangeSet<LineEndingValue> {
  let lineEndingOverrides = format.lineEndingOverrides;

  for (const run of affectedRuns) {
    const replacements = new Map<number, SourceLineEnding>();
    let previousLineEnding: SourceLineEnding | null = null;

    for (let position = run.from; position < run.to; position += 1) {
      let lineEnding =
        getLineEndingAt(state, format, position) ??
        format.dominantLineEnding;

      if (previousLineEnding === '\r' && lineEnding === '\n') {
        lineEnding = '\r';
        replacements.set(position, lineEnding);
      }

      previousLineEnding = lineEnding;
    }

    if (replacements.size > 0) {
      const positions = new Set(replacements.keys());
      const additions = [...replacements].flatMap(
        ([position, lineEnding]) =>
          lineEnding === format.dominantLineEnding
            ? []
            : [
                new LineEndingValue(lineEnding).range(
                  position,
                  position + 1,
                ),
              ],
      );

      lineEndingOverrides = lineEndingOverrides.update({
        add: additions,
        filter: (from) => !positions.has(from),
        filterFrom: run.from,
        filterTo: run.to,
        sort: true,
      });
    }
  }

  return lineEndingOverrides;
}

function hasTrailingLineEnding(
  state: EditorState,
): boolean {
  return (
    state.doc.length > 0 &&
    state.doc.sliceString(state.doc.length - 1) === '\n'
  );
}

function mapDocumentSourceFormat(
  value: DocumentSourceFormat,
  transaction: Transaction,
): DocumentSourceFormat {
  const replacedRanges = getReplacedDocumentRanges(transaction);
  let lineEndingOverrides = removeInvalidLineEndingOverrides(
    removeReplacedLineEndingOverrides(
      value.lineEndingOverrides,
      replacedRanges,
    ).map(transaction.changes),
    transaction.state,
    getUpdatedDocumentRanges(transaction),
  );
  const mappedFormat = {
    ...value,
    lineEndingOverrides,
  };
  const insertedGroups = getInsertedLineEndingGroups(transaction);
  const insertedPositions = new Set(insertedGroups.flat());
  const additions = insertedGroups.flatMap((group) =>
    group.flatMap((position) => {
      const lineEnding = getClosestPreservedLineEnding(
        transaction.state,
        mappedFormat,
        insertedPositions,
        group,
        position,
      );

      return lineEnding === value.dominantLineEnding
        ? []
        : [new LineEndingValue(lineEnding).range(position, position + 1)];
    }),
  );

  if (additions.length > 0) {
    lineEndingOverrides = lineEndingOverrides.update({
      add: additions,
      sort: true,
    });
  }

  lineEndingOverrides = disambiguateAdjacentLineEndings(
    transaction.state,
    {
      ...value,
      lineEndingOverrides,
    },
    getAffectedLineEndingRuns(transaction, insertedGroups),
  );

  return {
    ...value,
    hasTrailingLineEnding: hasTrailingLineEnding(transaction.state),
    lineEndingOverrides,
  };
}

function createDefaultDocumentSourceFormat(doc: Text): DocumentSourceFormat {
  return parseDocumentSource(doc.toString()).format;
}

export const setDocumentSourceFormat =
  StateEffect.define<DocumentSourceFormat>();

export const documentSourceFormatField =
  StateField.define<DocumentSourceFormat>({
    create: (state) => createDefaultDocumentSourceFormat(state.doc),
    update: (value, transaction) => {
      for (const effect of transaction.effects) {
        if (effect.is(setDocumentSourceFormat)) {
          return effect.value;
        }
      }

      return transaction.docChanged
        ? mapDocumentSourceFormat(value, transaction)
        : value;
    },
  });

export function documentSourceFormatExtension(
  format: DocumentSourceFormat,
): Extension {
  return [
    documentSourceFormatField.init(() => format),
    invertedEffects.of((transaction) => {
      const sourceFormatChanged = transaction.effects.some((effect) =>
        effect.is(setDocumentSourceFormat),
      );

      return transaction.docChanged || sourceFormatChanged
        ? [
            setDocumentSourceFormat.of(
              transaction.startState.field(documentSourceFormatField),
            ),
          ]
        : [];
    }),
  ];
}

export function documentSourceFormatsEqual(
  first: DocumentSourceFormat,
  second: DocumentSourceFormat,
): boolean {
  return (
    first.dominantLineEnding === second.dominantLineEnding &&
    first.hasTrailingLineEnding === second.hasTrailingLineEnding &&
    first.hasUtf8Bom === second.hasUtf8Bom &&
    RangeSet.eq(
      [first.lineEndingOverrides],
      [second.lineEndingOverrides],
    )
  );
}

export function serializeDocumentSource(state: EditorState): string {
  const format = state.field(documentSourceFormatField);
  const parts = format.hasUtf8Bom ? [UTF8_BOM] : [];
  const lineEndingOverrides = format.lineEndingOverrides.iter();
  const text = state.doc.iter();
  let position = 0;

  while (!text.next().done) {
    if (!text.lineBreak) {
      parts.push(text.value);
      position += text.value.length;
      continue;
    }

    const lineEnding =
      lineEndingOverrides.value &&
      lineEndingOverrides.from === position
        ? lineEndingOverrides.value.lineEnding
        : format.dominantLineEnding;
    parts.push(lineEnding);
    if (lineEndingOverrides.value?.lineEnding === lineEnding) {
      lineEndingOverrides.next();
    }
    position += 1;
  }

  if (lineEndingOverrides.value) {
    throw new Error(
      'Document source format contains an invalid line-ending override.',
    );
  }

  return parts.join('');
}
