import { describe, expect, it } from 'vitest';
import { i18n, resources } from './index';

const requiredCoreKeys = [
  'app.name',
  'app.emptyTitle',
  'command.openFile',
  'command.save',
  'command.saveAs',
  'command.toggleTheme',
  'command.toggleLanguage',
  'status.ready',
] as const;

describe('i18n resources', () => {
  it('provides English and Simplified Chinese values for every core UI key', async () => {
    for (const language of ['en', 'zh-CN'] as const) {
      const translation = resources[language].translation;

      for (const key of requiredCoreKeys) {
        expect(translation[key], `${language} is missing ${key}`).toEqual(
          expect.any(String),
        );
        expect(translation[key].trim(), `${language} has an empty ${key}`).not
          .toBe('');
      }
    }
  });

  it('initializes an i18next instance with English as the fallback language', async () => {
    expect(i18n.options.fallbackLng).toContain('en');
    expect(i18n.exists('app.name')).toBe(true);
    expect(i18n.t('status.ready', { lng: 'zh-CN' })).toBe('就绪');
  });
});
