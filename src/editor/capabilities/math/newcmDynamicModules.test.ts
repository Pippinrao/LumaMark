import { describe, expect, it } from 'vitest';
import {
  MathJaxNewcmFont,
  adoptNewcmDynamicFiles,
} from './newcmDynamicModules';

describe('newcmDynamicModules', () => {
  it('keeps latin setup on the CHTML font class after bundled modules load', () => {
    const latin = (
      MathJaxNewcmFont as unknown as {
        dynamicFiles: Record<string, { failed: boolean }>;
      }
    ).dynamicFiles.latin;

    expect(latin).toBeDefined();
    expect(latin?.failed).toBe(false);
  });

  it('copies dynamic file setup between duplicate NewCM font classes', () => {
    const source = {
      dynamicFiles: {
        latin: {
          failed: false,
          promise: Promise.resolve('loaded'),
          setup: () => undefined,
        },
      },
    };
    const target = {
      dynamicFiles: {
        latin: {
          failed: true,
          promise: null,
          setup: () => {
            throw new Error('placeholder setup');
          },
        },
      },
    };

    adoptNewcmDynamicFiles(source, target);
    expect(target.dynamicFiles.latin.failed).toBe(false);
    expect(target.dynamicFiles.latin.promise).toBe(source.dynamicFiles.latin.promise);
    expect(target.dynamicFiles.latin.setup).toBe(source.dynamicFiles.latin.setup);
  });
});
