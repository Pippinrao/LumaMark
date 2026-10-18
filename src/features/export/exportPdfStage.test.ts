import { afterEach, describe, expect, it } from 'vitest';
import { mountExportPdfStage } from './exportPdfStage';
import { EXPORT_PRINTING_CLASS, EXPORT_STAGE_CLASS } from './exportStyles';

const exportHtml =
  '<!doctype html><html><head><style>.lm-export-document{width:174mm}</style></head>' +
  '<body><main class="lm-export-document"><h1>Title</h1><p>Body</p></main></body></html>';

describe('mountExportPdfStage', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.body.removeAttribute('style');
    document.head.querySelector('#lm-export-print-style')?.remove();
    document.body
      .querySelectorAll(`.${EXPORT_STAGE_CLASS}`)
      .forEach((node) => node.remove());
  });

  it('promotes a self-contained light stage and restores the app', async () => {
    document.documentElement.dataset.theme = 'dark';
    document.body.style.background = '#17191d';
    document.body.style.color = '#f2f4f8';
    document.body.innerHTML = '<div id="app">app shell</div>';

    const cleanup = await mountExportPdfStage(exportHtml);

    expect(
      document.documentElement.classList.contains(EXPORT_PRINTING_CLASS),
    ).toBe(true);
    expect(document.body.style.getPropertyValue('background')).toBe(
      'rgb(255, 255, 255)',
    );
    expect(document.body.style.getPropertyValue('color')).toBe(
      'rgb(31, 35, 40)',
    );

    const host = document.body.querySelector<HTMLElement>(
      `.${EXPORT_STAGE_CLASS}`,
    );
    expect(host).not.toBeNull();
    expect(host?.style.getPropertyValue('background')).toBe(
      'rgb(255, 255, 255)',
    );
    expect(host?.style.getPropertyValue('color')).toBe('rgb(31, 35, 40)');
    expect(host?.style.getPropertyValue('position')).toBe('static');
    expect(document.getElementById('app')?.style.display).toBe('none');

    cleanup();

    expect(
      document.documentElement.classList.contains(EXPORT_PRINTING_CLASS),
    ).toBe(false);
    expect(document.body.style.getPropertyValue('background')).toBe(
      'rgb(23, 25, 29)',
    );
    expect(document.body.style.getPropertyValue('color')).toBe(
      'rgb(242, 244, 248)',
    );
    expect(document.getElementById('app')?.style.display).toBe('');
    expect(host?.isConnected).toBe(false);
  });
});
