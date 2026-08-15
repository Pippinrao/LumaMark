import { describe, expect, it } from 'vitest';

import {
  createDefaultLumaMarkSettings,
  MAX_SETTINGS_FONT_ZOOM_PERCENT,
  MIN_SETTINGS_FONT_ZOOM_PERCENT,
  normalizeLumaMarkSettings,
  SETTINGS_FONT_ZOOM_STEP_PERCENT,
  SETTINGS_VERSION,
} from './settingsTypes';
import settingsContract from '../../../tests/fixtures/settings-v2-contract.json';

function createRawSettings(version: number | undefined = SETTINGS_VERSION) {
  const value: Record<string, unknown> = {
    appearance: {
      fontZoomPercent: 100,
      pageWidth: 'standard',
      sidebarOpenOnStartup: true,
      theme: 'light',
    },
    editor: {
      defaultDisplayMode: 'livePreview',
      focusModeOnStartup: false,
    },
    general: {
      language: 'zh-CN',
      openWindowMode: 'multiWindow',
      startupBehavior: 'home',
    },
    images: { copyImagesToAssets: false },
    updates: { autoCheckOnStartup: true },
  };

  if (version !== undefined) {
    value.version = version;
  }

  return value;
}

describe('settings v2 contract', () => {
  it('defines one complete v2 default document', () => {
    expect(SETTINGS_VERSION).toBe(2);
    expect(createDefaultLumaMarkSettings()).toEqual({
      appearance: {
        fontZoomPercent: 100,
        pageWidth: 'standard',
        sidebarOpenOnStartup: true,
        theme: 'light',
      },
      editor: {
        defaultDisplayMode: 'livePreview',
        focusModeOnStartup: false,
      },
      general: {
        language: 'zh-CN',
        openWindowMode: 'multiWindow',
        startupBehavior: 'home',
      },
      images: { copyImagesToAssets: false },
      updates: { autoCheckOnStartup: true },
      version: 2,
    });
  });

  it('matches the shared TS and Rust contract and accepts every declared enum value', () => {
    expect(createDefaultLumaMarkSettings()).toEqual(settingsContract.defaults);

    const enumFields = {
      'appearance.pageWidth': ['appearance', 'pageWidth'],
      'appearance.theme': ['appearance', 'theme'],
      'editor.defaultDisplayMode': ['editor', 'defaultDisplayMode'],
      'general.language': ['general', 'language'],
      'general.openWindowMode': ['general', 'openWindowMode'],
      'general.startupBehavior': ['general', 'startupBehavior'],
    } as const;
    const allowedEnums = settingsContract.allowedEnums as Record<
      keyof typeof enumFields,
      readonly string[]
    >;

    expect(Object.keys(allowedEnums).sort()).toEqual(
      Object.keys(enumFields).sort(),
    );

    for (const [contractKey, [section, field]] of Object.entries(enumFields)) {
      for (const allowedValue of allowedEnums[
        contractKey as keyof typeof enumFields
      ]) {
        const raw = createRawSettings();
        (raw[section] as Record<string, unknown>)[field] = allowedValue;

        const result = normalizeLumaMarkSettings(raw);

        expect(result.hadInvalidFields).toBe(false);
        expect(
          (result.settings[section] as unknown as Record<string, unknown>)[
            field
          ],
        ).toBe(allowedValue);
      }
    }
  });

  it('matches every shared font zoom boundary and step', () => {
    expect(MIN_SETTINGS_FONT_ZOOM_PERCENT).toBe(settingsContract.fontZoom.min);
    expect(MAX_SETTINGS_FONT_ZOOM_PERCENT).toBe(settingsContract.fontZoom.max);
    expect(SETTINGS_FONT_ZOOM_STEP_PERCENT).toBe(
      settingsContract.fontZoom.step,
    );
    expect(createDefaultLumaMarkSettings().appearance.fontZoomPercent).toBe(
      settingsContract.fontZoom.default,
    );

    for (
      let zoom = settingsContract.fontZoom.min;
      zoom <= settingsContract.fontZoom.max;
      zoom += settingsContract.fontZoom.step
    ) {
      const raw = createRawSettings();
      (raw.appearance as Record<string, unknown>).fontZoomPercent = zoom;
      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(false);
      expect(result.settings.appearance.fontZoomPercent).toBe(zoom);
    }

    for (const zoom of [
      settingsContract.fontZoom.min - 1,
      settingsContract.fontZoom.min + 1,
      settingsContract.fontZoom.max + 1,
    ]) {
      const raw = createRawSettings();
      (raw.appearance as Record<string, unknown>).fontZoomPercent = zoom;
      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(true);
      expect(result.settings.appearance.fontZoomPercent).toBe(
        settingsContract.fontZoom.default,
      );
    }
  });

  it.each([0, 49, 55, 125, 251, Number.NaN])(
    'recovers invalid zoom %s to the field default instead of clamping',
    (fontZoomPercent) => {
      const raw = createRawSettings();
      (raw.appearance as Record<string, unknown>).fontZoomPercent =
        fontZoomPercent;

      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(true);
      expect(result.settings.appearance.fontZoomPercent).toBe(100);
    },
  );

  it('recovers invalid enum and boolean fields independently', () => {
    const raw = createRawSettings();
    Object.assign(raw.appearance as object, {
      pageWidth: 'poster',
      sidebarOpenOnStartup: 'yes',
      theme: 'sepia',
    });
    Object.assign(raw.updates as object, { autoCheckOnStartup: 'yes' });
    Object.assign(raw.general as object, { openWindowMode: 'sameWindow' });

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(true);
    expect(result.settings.appearance).toMatchObject({
      pageWidth: 'standard',
      sidebarOpenOnStartup: true,
      theme: 'light',
    });
    expect(result.settings.updates.autoCheckOnStartup).toBe(true);
    expect(result.settings.general.openWindowMode).toBe('multiWindow');
  });

  it.each([undefined, 0, 1, 2])(
    'supplies and marks a missing open-window mode for settings version %s',
    (version) => {
      const raw = createRawSettings(version);
      delete (raw.general as Record<string, unknown>).openWindowMode;

      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(true);
      expect(result.settings.general.openWindowMode).toBe('multiWindow');
    },
  );

  it.each(['missing', 0, 1] as const)(
    'migrates settings version %s to v2 and supplies the updater default',
    (version) => {
      const raw = createRawSettings(version === 'missing' ? 0 : version);
      if (version === 'missing') {
        delete raw.version;
      }
      delete raw.updates;

      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(false);
      expect(result.settings.version).toBe(2);
      expect(result.settings.updates.autoCheckOnStartup).toBe(true);
    },
  );

  it('rejects a future version instead of silently downgrading it', () => {
    expect(() => normalizeLumaMarkSettings(createRawSettings(99))).toThrow(
      expect.objectContaining({ code: 'settings.unsupported_version' }),
    );
  });

  it('rejects a JSON numeric version that overflows to Infinity', () => {
    const raw = JSON.parse('{"version":1e400}') as Record<string, unknown>;

    expect(raw.version).toBe(Number.POSITIVE_INFINITY);
    expect(() => normalizeLumaMarkSettings(raw)).toThrow(
      expect.objectContaining({ code: 'settings.unsupported_version' }),
    );
  });

  it.each([
    ['string', '3'],
    ['negative', -1],
    ['fraction', 1.5],
    ['NaN', Number.NaN],
  ] as const)('recovers a non-future invalid %s version as v0', (_, version) => {
    const raw = createRawSettings();
    raw.version = version;

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(true);
    expect(result.settings.version).toBe(SETTINGS_VERSION);
  });

  it('ignores unknown fields without marking a valid document invalid', () => {
    const raw = createRawSettings();
    raw.pluginBucket = { future: true };

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(false);
    expect(result.settings).not.toHaveProperty('pluginBucket');
  });
});
