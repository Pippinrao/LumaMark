import { describe, expect, it } from 'vitest';

import { interpretDocumentSaveResult } from './documentSaveOutcome';

describe('interpretDocumentSaveResult', () => {
  it('maps a successful persist of the attempted revision to saved', () => {
    expect(
      interpretDocumentSaveResult({
        attemptedRevision: 3,
        result: { data: { path: 'E:/note.md' }, ok: true },
        sessionAfter: { dirty: false, revision: 3 },
      }),
    ).toEqual({ revision: 3, status: 'saved' });
  });

  it('maps a failed command to failed without inventing success', () => {
    expect(
      interpretDocumentSaveResult({
        attemptedRevision: 3,
        result: {
          error: {
            code: 'file.write_failed',
            message: 'disk full',
            recoverable: true,
          },
          ok: false,
        },
        sessionAfter: { dirty: true, revision: 3 },
      }),
    ).toEqual({ revision: 3, status: 'failed' });
  });

  it('maps a cancelled save dialog to cancelled', () => {
    expect(
      interpretDocumentSaveResult({
        attemptedRevision: 3,
        result: { data: null, ok: true },
        sessionAfter: { dirty: true, revision: 3 },
      }),
    ).toEqual({ revision: 3, status: 'cancelled' });
  });

  it('maps a later dirty revision to superseded', () => {
    expect(
      interpretDocumentSaveResult({
        attemptedRevision: 3,
        result: { data: { path: 'E:/note.md' }, ok: true },
        sessionAfter: { dirty: true, revision: 4 },
      }),
    ).toEqual({ revision: 3, status: 'superseded' });
  });

  it('maps a completed write that left the same revision dirty as stillDirty', () => {
    expect(
      interpretDocumentSaveResult({
        attemptedRevision: 3,
        result: { data: { path: 'E:/note.md' }, ok: true },
        sessionAfter: { dirty: true, revision: 3 },
      }),
    ).toEqual({ revision: 3, status: 'stillDirty' });
  });
});
