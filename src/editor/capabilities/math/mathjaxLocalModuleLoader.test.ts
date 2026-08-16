import { mathjax } from '@mathjax/src/js/mathjax.js';
import { describe, expect, it } from 'vitest';
import './mathjaxLocalModuleLoader';

describe('mathjaxLocalModuleLoader', () => {
  it('resolves NewCM dynamic files from the MathJax module id', async () => {
    await expect(
      mathjax.asyncLoad(
        '@mathjax/mathjax-newcm-font/js/chtml/dynamic/latin.js',
      ),
    ).resolves.toBeTruthy();
  });
});
