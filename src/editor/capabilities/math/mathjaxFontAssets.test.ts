import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  bundledNewcmFontUrls,
  preloadBundledNewcmFonts,
  rewriteNewcmFontUrls,
  applyPreloadedNewcmFontUrls,
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

  it('preloads every packaged NewCM font once before later formulas go offline', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        return {
          arrayBuffer: async () => new ArrayBuffer(8),
          ok: true,
        };
      }),
    );

    await preloadBundledNewcmFonts();
    await preloadBundledNewcmFonts();

    expect(fetched).toHaveLength(105);
    expect(fetched).toEqual(
      expect.arrayContaining(Object.values(bundledNewcmFontUrls)),
    );
    expect(
      applyPreloadedNewcmFontUrls(
        'src: url("/node_modules/.pnpm/pkg/chtml/woff2/mjx-ncm-n.woff2?no-inline")',
      ),
    ).toMatch(/^src: url\("blob:/u);
  });
});
