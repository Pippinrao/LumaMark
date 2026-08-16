import { describe, expect, it } from 'vitest';

import {
  createDefaultLumaMarkSettings,
  MAX_SETTINGS_FONT_ZOOM_PERCENT,
  MIN_SETTINGS_FONT_ZOOM_PERCENT,
  normalizeLumaMarkSettings,
  SETTINGS_FONT_ZOOM_STEP_PERCENT,
  SETTINGS_VERSION,
} from './settingsTypes';
import settingsContract from '../../../tests/fixtures/settings-v3-contract.json';

function createRawSettings(version: number | undefined = SETTINGS_VERSION) {
  const value: Record<string, unknown> = {
    appearance: {
      fontZoomPercent: 100,
      pageWidth: 'standard',
      sidebarOpenOnStartup: true,
      theme: 'light',
    },
    editor: {
      ...(version === undefined || version >= SETTINGS_VERSION
        ? { autosaveEnabled: false }
        : {}),
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

describe('settings v3 contract', () => {
  it('defines one complete v3 default document', () => {
    expect(SETTINGS_VERSION).toBe(3);
    expect(createDefaultLumaMarkSettings()).toEqual({
      appearance: {
        fontZoomPercent: 100,
        pageWidth: 'standard',
        sidebarOpenOnStartup: true,
        theme: 'light',
      },
      editor: {
        autosaveEnabled: false,
        defaultDisplayMode: 'livePreview',
        focusModeOnStartup: false,
      },
      general: {
        language: 'zh-CN',
        openWindowMode: 'multiWindow',
        startupBehavior: 'home',
      },
      images: { copyImagesToAssets: false },
      markdown: {
        math: {
          equationNumbering: 'none',
          physicsEnabled: false,
          syntaxMode: 'pandoc',
        },
        plantuml: {
          enabled: true,
        },
      },
      updates: { autoCheckOnStartup: true },
      version: 3,
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

  it.each(['missing', 0, 1, 2] as const)(
    'migrates settings version %s to v3 and supplies updater and autosave defaults',
    (version) => {
      const raw = createRawSettings(version === 'missing' ? 0 : version);
      if (version === 'missing') {
        delete raw.version;
      }
      delete raw.updates;
      delete (raw.editor as Record<string, unknown>).autosaveEnabled;

      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(false);
      expect(result.settings.version).toBe(3);
      expect(result.settings.updates.autoCheckOnStartup).toBe(true);
      expect(result.settings.editor.autosaveEnabled).toBe(false);
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

describe('settings v3 autosave preference', () => {
  it('defaults autosave to off in the canonical v3 document', () => {
    expect(SETTINGS_VERSION).toBe(3);
    expect(createDefaultLumaMarkSettings().editor.autosaveEnabled).toBe(false);
    expect(createDefaultLumaMarkSettings().version).toBe(3);
  });

  it('migrates a valid v2 document without marking autosave missing as invalid', () => {
    const raw = createRawSettings(2);

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(false);
    expect(result.settings.version).toBe(3);
    expect(result.settings.editor.autosaveEnabled).toBe(false);
  });

  it('preserves an explicit autosave opt-in', () => {
    const raw = createRawSettings(3);
    (raw.editor as Record<string, unknown>).autosaveEnabled = true;

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(false);
    expect(result.settings.editor.autosaveEnabled).toBe(true);
  });

  it('marks a current-version document missing autosave as recovered to off', () => {
    const raw = createRawSettings(3);
    delete (raw.editor as Record<string, unknown>).autosaveEnabled;

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(true);
    expect(result.settings.editor.autosaveEnabled).toBe(false);
  });
});

describe('settings markdown.math preferences', () => {
  it('defaults math to pandoc, none numbering, and physics off', () => {
    expect(createDefaultLumaMarkSettings().markdown.math).toEqual({
      equationNumbering: 'none',
      physicsEnabled: false,
      syntaxMode: 'pandoc',
    });
  });

  it('accepts a missing markdown.math object on existing v3 documents without marking them invalid', () => {
    const raw = createRawSettings(3);

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(false);
    expect(result.settings.markdown.math).toEqual({
      equationNumbering: 'none',
      physicsEnabled: false,
      syntaxMode: 'pandoc',
    });
    expect(result.settings.markdown.plantuml).toEqual({ enabled: true });
  });

  it.each(['pandoc', 'legacy', 'disabled'] as const)(
    'accepts syntaxMode %s',
    (syntaxMode) => {
      const raw = createRawSettings(3);
      raw.markdown = {
        math: {
          equationNumbering: 'ams',
          physicsEnabled: true,
          syntaxMode,
        },
      };

      const result = normalizeLumaMarkSettings(raw);

      expect(result.hadInvalidFields).toBe(false);
      expect(result.settings.markdown.math).toEqual({
        equationNumbering: 'ams',
        physicsEnabled: true,
        syntaxMode,
      });
    },
  );

  it('recovers an invalid math syntax mode without dropping the rest of the document', () => {
    const raw = createRawSettings(3);
    raw.markdown = {
      math: {
        equationNumbering: 'all',
        physicsEnabled: true,
        syntaxMode: 'katex',
      },
    };

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(true);
    expect(result.settings.markdown.math).toEqual({
      equationNumbering: 'all',
      physicsEnabled: true,
      syntaxMode: 'pandoc',
    });
  });
});

describe('settings markdown.plantuml preferences', () => {
  it('defaults PlantUML preview to enabled', () => {
    expect(createDefaultLumaMarkSettings().markdown.plantuml).toEqual({
      enabled: true,
    });
  });

  it('accepts a missing markdown.plantuml object on existing v3 documents without marking them invalid', () => {
    const raw = createRawSettings(3);
    raw.markdown = {
      math: {
        equationNumbering: 'ams',
        physicsEnabled: true,
        syntaxMode: 'legacy',
      },
    };

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(false);
    expect(result.settings.markdown.math.syntaxMode).toBe('legacy');
    expect(result.settings.markdown.plantuml.enabled).toBe(true);
  });

  it('preserves an explicit PlantUML opt-out', () => {
    const raw = createRawSettings(3);
    raw.markdown = {
      math: {
        equationNumbering: 'none',
        physicsEnabled: false,
        syntaxMode: 'pandoc',
      },
      plantuml: { enabled: false },
    };

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(false);
    expect(result.settings.markdown.plantuml.enabled).toBe(false);
  });

  it('recovers a non-boolean PlantUML switch without dropping math preferences', () => {
    const raw = createRawSettings(3);
    raw.markdown = {
      math: {
        equationNumbering: 'all',
        physicsEnabled: true,
        syntaxMode: 'legacy',
      },
      plantuml: { enabled: 'off' },
    };

    const result = normalizeLumaMarkSettings(raw);

    expect(result.hadInvalidFields).toBe(true);
    expect(result.settings.markdown.math).toEqual({
      equationNumbering: 'all',
      physicsEnabled: true,
      syntaxMode: 'legacy',
    });
    expect(result.settings.markdown.plantuml.enabled).toBe(true);
  });
});
