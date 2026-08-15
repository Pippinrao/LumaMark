import { describe, expect, it } from 'vitest';
import { canonicalizeTableFixtures } from '../e2e/support/canonicalTableFixture';

describe('canonicalizeTableFixtures', () => {
  it('pads only test table blocks while preserving surrounding Markdown', () => {
    expect(
      canonicalizeTableFixtures(
        [
          'before',
          '',
          '| A | Value |',
          '| :--- | ---: |',
          '| longer | 1 |',
          '',
          'after',
        ].join('\n'),
      ),
    ).toBe(
      [
        'before',
        '',
        '| A      | Value |',
        '| :----- | ----: |',
        '| longer | 1     |',
        '',
        'after',
      ].join('\n'),
    );
  });

  it('reserves the mature component minimum width for alignment marks', () => {
    expect(
      canonicalizeTableFixtures(
        ['| L | C | R |', '| :--- | :---: | ---: |', '| x | x | x |'].join(
          '\n',
        ),
      ),
    ).toBe(
      ['| L  | C   | R  |', '| :- | :-: | -: |', '| x  | x   | x  |'].join(
        '\n',
      ),
    );
  });
});
