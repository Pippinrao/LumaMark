import { describe, expect, it } from 'vitest';
import {
  EXPORT_DOCUMENT_CSS,
  EXPORT_PRINTING_CLASS,
  EXPORT_PRINT_STAGE_CSS,
  EXPORT_STAGE_CLASS,
} from './exportStyles';

describe('export print styles', () => {
  it('defines a light document contract on the shadow host', () => {
    expect(EXPORT_DOCUMENT_CSS).toContain(':host {');
    expect(EXPORT_DOCUMENT_CSS).toContain('--lm-export-text: #1f2328;');
    expect(EXPORT_DOCUMENT_CSS).toContain('background: #ffffff;');
    expect(EXPORT_DOCUMENT_CSS).toContain('color: var(--lm-export-text);');
    expect(EXPORT_DOCUMENT_CSS).toContain('color-scheme: light;');
  });

  it('forces a white printable page even when the app uses a dark theme', () => {
    expect(EXPORT_PRINT_STAGE_CSS).toContain('color-scheme: light !important;');
    expect(EXPORT_PRINT_STAGE_CSS).toContain('min-height: 100vh;');
    expect(EXPORT_PRINT_STAGE_CSS).toContain('background: #ffffff !important;');
    expect(EXPORT_PRINT_STAGE_CSS).toContain('color: #1f2328 !important;');
    expect(EXPORT_PRINT_STAGE_CSS).toContain(
      `html.${EXPORT_PRINTING_CLASS}`,
    );
    expect(EXPORT_PRINT_STAGE_CSS).toContain(
      `body > *:not(.${EXPORT_STAGE_CLASS})`,
    );
  });
});
