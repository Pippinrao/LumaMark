import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bundledNewcmFontUrls,
  rewriteNewcmFontUrls,
} from './mathjaxFontAssets';

describe('bundled MathJax NewCM fonts', () => {
  it('emits every NewCM WOFF2 as a same-origin Vite asset URL', async () => {
    const packageDirectory = path.dirname(
      require.resolve('@mathjax/mathjax-newcm-font/package.json'),
    );
    const packagedFonts = (await readdir(
      path.join(packageDirectory, 'chtml', 'woff2'),
    )).filter((name) => name.endsWith('.woff2'));

    expect(packagedFonts).toHaveLength(105);
    expect(Object.keys(bundledNewcmFontUrls)).toHaveLength(105);
    expect(Object.values(bundledNewcmFontUrls)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^data:|^\/assets\/|^\/src\/|^\/node_modules\/|^\/@fs\/|^\.\.?\//,
        ),
      ]),
    );
    const font = await readFile(
      path.join(packageDirectory, 'chtml', 'woff2', packagedFonts[0] as string),
    );
    expect(font.byteLength).toBeGreaterThan(0);
    expect(rewriteNewcmFontUrls(
      'src: url("/node_modules/.pnpm/pkg/chtml/woff2/mjx-ncm-n.woff2")',
    )).toBe(`src: url("${bundledNewcmFontUrls['mjx-ncm-n.woff2']}")`);
    expect(
      rewriteNewcmFontUrls(
        'url("/node_modules/.pnpm/@mathjax+mathjax-newcm-font@4.1.3/node_modules/@mathjax/mathjax-newcm-font/chtml/woff2/mjx-ncm-n.woff2")',
      ),
    ).toBe(`url("${bundledNewcmFontUrls['mjx-ncm-n.woff2']}")`);
  });
});
