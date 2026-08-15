export type SettingsTheme = 'dark' | 'light' | 'system';
export type SettingsPageWidth = 'fluid' | 'narrow' | 'standard' | 'wide';
export type SettingsLanguage = 'en' | 'zh-CN';
export type SettingsOpenWindowMode = 'aggregateWindow' | 'multiWindow';
export type SettingsStartupBehavior = 'home' | 'restoreLastSession';
export type SettingsDisplayMode = 'livePreview' | 'source';

export type LumaMarkSettings = {
  appearance: {
    fontZoomPercent: number;
    pageWidth: SettingsPageWidth;
    sidebarOpenOnStartup: boolean;
    theme: SettingsTheme;
  };
  editor: {
    autosaveEnabled: boolean;
    defaultDisplayMode: SettingsDisplayMode;
    focusModeOnStartup: boolean;
  };
  general: {
    language: SettingsLanguage;
    openWindowMode: SettingsOpenWindowMode;
    startupBehavior: SettingsStartupBehavior;
  };
  images: {
    copyImagesToAssets: boolean;
  };
  updates: {
    autoCheckOnStartup: boolean;
  };
  version: 2;
};

export type SettingsLoadResult = {
  corruptBackupPath: string | null;
  hadInvalidFields: boolean;
  settings: LumaMarkSettings;
  settingsFileExists: boolean;
  usedDefaultsDueToCorruption: boolean;
};

export const SETTINGS_VERSION = 3 as const;
export const MIN_SETTINGS_FONT_ZOOM_PERCENT = 50;
export const MAX_SETTINGS_FONT_ZOOM_PERCENT = 250;
export const SETTINGS_FONT_ZOOM_STEP_PERCENT = 10;

export const DEFAULT_LUMA_MARK_SETTINGS: LumaMarkSettings = {
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
  images: {
    copyImagesToAssets: false,
  },
  updates: {
    autoCheckOnStartup: true,
  },
  version: SETTINGS_VERSION,
};

const PAGE_WIDTHS: readonly SettingsPageWidth[] = [
  'narrow',
  'standard',
  'wide',
  'fluid',
];

const OPEN_WINDOW_MODES: readonly SettingsOpenWindowMode[] = [
  'multiWindow',
  'aggregateWindow',
];

export function createDefaultLumaMarkSettings(): LumaMarkSettings {
  return structuredClone(DEFAULT_LUMA_MARK_SETTINGS);
}

export class UnsupportedSettingsVersionError extends Error {
  readonly code = 'settings.unsupported_version';

  constructor(readonly version: number) {
    super(`Settings version ${version} is newer than version ${SETTINGS_VERSION}.`);
    this.name = 'UnsupportedSettingsVersionError';
  }
}

export function normalizeLumaMarkSettings(
  value: unknown,
): {
  settings: LumaMarkSettings;
  hadInvalidFields: boolean;
} {
  const defaults = createDefaultLumaMarkSettings();

  if (!isRecord(value)) {
    return { hadInvalidFields: true, settings: defaults };
  }

  const sourceVersion = readSourceVersion(value.version);
  if (sourceVersion.value > SETTINGS_VERSION) {
    throw new UnsupportedSettingsVersionError(sourceVersion.value);
  }

  let hadInvalidFields = sourceVersion.invalid;
  const appearance = isRecord(value.appearance) ? value.appearance : {};
  const editor = isRecord(value.editor) ? value.editor : {};
  const general = isRecord(value.general) ? value.general : {};
  const images = isRecord(value.images) ? value.images : {};
  const updates = isRecord(value.updates) ? value.updates : {};

  if (
    !isRecord(value.appearance) ||
    !isRecord(value.editor) ||
    !isRecord(value.general) ||
    !isRecord(value.images) ||
    (sourceVersion.value >= SETTINGS_VERSION && !isRecord(value.updates))
  ) {
    hadInvalidFields = true;
  }

  const theme = normalizeEnum(
    appearance.theme,
    ['light', 'dark', 'system'] as const,
    defaults.appearance.theme,
  );
  const pageWidth = normalizeEnum(
    appearance.pageWidth,
    PAGE_WIDTHS,
    defaults.appearance.pageWidth,
  );
  const language = normalizeEnum(
    general.language,
    ['zh-CN', 'en'] as const,
    defaults.general.language,
  );
  const startupBehavior = normalizeEnum(
    general.startupBehavior,
    ['home', 'restoreLastSession'] as const,
    defaults.general.startupBehavior,
  );
  const openWindowMode = normalizeEnum(
    general.openWindowMode,
    OPEN_WINDOW_MODES,
    defaults.general.openWindowMode,
  );
  const defaultDisplayMode = normalizeEnum(
    editor.defaultDisplayMode,
    ['livePreview', 'source'] as const,
    defaults.editor.defaultDisplayMode,
  );
  const fontZoom = normalizeFontZoom(appearance.fontZoomPercent);
  const sidebarOpenOnStartup = normalizeBoolean(
    appearance.sidebarOpenOnStartup,
    defaults.appearance.sidebarOpenOnStartup,
  );
  const focusModeOnStartup = normalizeBoolean(
    editor.focusModeOnStartup,
    defaults.editor.focusModeOnStartup,
  );
  const autosaveEnabled =
    sourceVersion.value < SETTINGS_VERSION && editor.autosaveEnabled === undefined
      ? { invalid: false, value: defaults.editor.autosaveEnabled }
      : normalizeBoolean(
          editor.autosaveEnabled,
          defaults.editor.autosaveEnabled,
        );
  const copyImagesToAssets = normalizeBoolean(
    images.copyImagesToAssets,
    defaults.images.copyImagesToAssets,
  );
  const autoCheckOnStartup =
    sourceVersion.value < SETTINGS_VERSION && value.updates === undefined
      ? { invalid: false, value: defaults.updates.autoCheckOnStartup }
      : normalizeBoolean(
          updates.autoCheckOnStartup,
          defaults.updates.autoCheckOnStartup,
        );

  if (
    theme.invalid ||
    pageWidth.invalid ||
    language.invalid ||
    openWindowMode.invalid ||
    startupBehavior.invalid ||
    defaultDisplayMode.invalid ||
    fontZoom.invalid ||
    sidebarOpenOnStartup.invalid ||
    focusModeOnStartup.invalid ||
    copyImagesToAssets.invalid ||
    autosaveEnabled.invalid ||
    autoCheckOnStartup.invalid
  ) {
    hadInvalidFields = true;
  }

  return {
    hadInvalidFields,
    settings: {
      appearance: {
        fontZoomPercent: fontZoom.value,
        pageWidth: pageWidth.value,
        sidebarOpenOnStartup: sidebarOpenOnStartup.value,
        theme: theme.value,
      },
      editor: {
        autosaveEnabled: autosaveEnabled.value,
        defaultDisplayMode: defaultDisplayMode.value,
        focusModeOnStartup: focusModeOnStartup.value,
      },
      general: {
        language: language.value,
        openWindowMode: openWindowMode.value,
        startupBehavior: startupBehavior.value,
      },
      images: {
        copyImagesToAssets: copyImagesToAssets.value,
      },
      updates: {
        autoCheckOnStartup: autoCheckOnStartup.value,
      },
      version: SETTINGS_VERSION,
    },
  };
}

function normalizeFontZoom(value: unknown): { invalid: boolean; value: number } {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_SETTINGS_FONT_ZOOM_PERCENT ||
    value > MAX_SETTINGS_FONT_ZOOM_PERCENT ||
    value % SETTINGS_FONT_ZOOM_STEP_PERCENT !== 0
  ) {
    return { invalid: true, value: DEFAULT_LUMA_MARK_SETTINGS.appearance.fontZoomPercent };
  }

  return { invalid: false, value };
}

function normalizeBoolean(
  value: unknown,
  fallback: boolean,
): { invalid: boolean; value: boolean } {
  return typeof value === 'boolean'
    ? { invalid: false, value }
    : { invalid: true, value: fallback };
}

function readSourceVersion(value: unknown): {
  invalid: boolean;
  value: number;
} {
  if (value === undefined) {
    return { invalid: false, value: 0 };
  }

  if (typeof value === 'number' && value > SETTINGS_VERSION) {
    return { invalid: false, value };
  }

  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0
  ) {
    return { invalid: false, value };
  }

  return { invalid: true, value: 0 };
}

function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): { invalid: boolean; value: T } {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return { invalid: false, value: value as T };
  }

  return { invalid: true, value: fallback };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
