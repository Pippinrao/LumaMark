import '@testing-library/jest-dom/vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { useAppPreferencesStore } from '../../app/stores/appPreferencesStore';
import { SettingsDialog } from './SettingsDialog';

function renderSettings(
  overrides: Partial<ComponentProps<typeof SettingsDialog>> = {},
) {
  const props: ComponentProps<typeof SettingsDialog> = {
    autoCheckUpdates: true,
    closeErrorCode: null,
    copyImagesToAssets: false,
    defaultDisplayMode: 'livePreview',
    focusModeOnStartup: false,
    fontZoomPercent: 100,
    language: 'zh-CN',
    onAutoCheckUpdatesChange: vi.fn(),
    onClearRecentFiles: vi.fn(),
    onCopyImagesToAssetsChange: vi.fn(),
    onDefaultDisplayModeChange: vi.fn(),
    onFocusModeOnStartupChange: vi.fn(),
    onFontZoomPercentChange: vi.fn(),
    onLanguageChange: vi.fn(),
    onOpenChange: vi.fn(),
    onPageWidthChange: vi.fn(),
    onReturnFocus: vi.fn(),
    onSidebarOpenOnStartupChange: vi.fn(),
    onStartupBehaviorChange: vi.fn(),
    onThemeChange: vi.fn(),
    open: true,
    pageWidth: 'standard',
    pageWidthPersistenceError: false,
    recentFilesPersistenceError: false,
    settingsLoadState: { status: 'ready' },
    settingsRecoveryState: { kind: 'none' },
    settingsWriteState: { status: 'idle' },
    onRetrySettingsWrite: vi.fn(),
    sidebarOpenOnStartup: true,
    startupBehavior: 'home',
    startupPersistenceError: false,
    theme: 'light',
    ...overrides,
  };

  return {
    props,
    ...render(
      <I18nProvider>
        <SettingsDialog {...props} />
      </I18nProvider>,
    ),
  };
}

function activateTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  tab.focus();
  fireEvent.keyDown(tab, { key: 'Enter' });
  return tab;
}

describe('SettingsDialog', () => {
  afterEach(cleanup);

  it('uses vertical sections and changes startup behavior from general', () => {
    useAppPreferencesStore.setState({ language: 'zh-CN' });
    const onStartupBehaviorChange = vi.fn();
    renderSettings({ onStartupBehaviorChange });

    const generalTab = screen.getByRole('tab', { name: '通用' });
    expect(generalTab.closest('[aria-orientation="vertical"]')).not.toBeNull();
    fireEvent.click(
      screen.getByRole('radio', { name: '恢复上次文件或工作区' }),
    );
    expect(onStartupBehaviorChange).toHaveBeenCalledWith('restoreLastSession');
  });

  it('marks the dialog as window-interactive and exposes stable vertical navigation without search', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    renderSettings({ language: 'en' });

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveAttribute('data-lm-window-interactive');
    expect(within(dialog).queryByRole('searchbox')).toBeNull();

    const tablist = within(dialog).getByRole('tablist');
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical');
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('data-value')),
    ).toEqual(['general', 'appearance', 'editor', 'images']);
  });

  it.each([
    {
      appearanceDescription:
        'Choose how LumaMark and the writing canvas look.',
      editorDescription:
        'Set the default writing experience for new documents.',
      groups: {
        editor: 'Writing defaults',
        images: 'Image handling',
        language: 'Language & region',
        recent: 'Recent items',
        startup: 'Startup',
        theme: 'Theme',
        writingCanvas: 'Writing canvas',
      },
      imagesDescription: 'Control how inserted images are handled.',
      language: 'en' as const,
      pageDescription: 'Manage language, startup, and recent items.',
      tabs: {
        appearance: 'Appearance',
        editor: 'Editor',
        general: 'General',
        images: 'Images',
      },
    },
    {
      appearanceDescription: '调整 LumaMark 和写作画布的外观。',
      editorDescription: '设置新文档的默认写作体验。',
      groups: {
        editor: '写作默认值',
        images: '图片处理',
        language: '语言与区域',
        recent: '最近项目',
        startup: '启动',
        theme: '主题',
        writingCanvas: '写作画布',
      },
      imagesDescription: '控制插入图片的处理方式。',
      language: 'zh-CN' as const,
      pageDescription: '管理语言、启动方式和最近项目。',
      tabs: {
        appearance: '外观',
        editor: '编辑器',
        general: '通用',
        images: '图片',
      },
    },
  ])(
    'renders localized page headings, descriptions, and semantic groups in $language',
    ({
      appearanceDescription,
      editorDescription,
      groups,
      imagesDescription,
      language,
      pageDescription,
      tabs,
    }) => {
      useAppPreferencesStore.setState({ language });
      renderSettings({ language });

      expect(
        screen.getByRole('heading', { level: 2, name: tabs.general }),
      ).toBeInTheDocument();
      expect(screen.getByText(pageDescription)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: groups.language })).toBeVisible();
      expect(screen.getByRole('region', { name: groups.startup })).toBeVisible();
      expect(screen.getByRole('region', { name: groups.recent })).toBeVisible();

      activateTab(tabs.appearance);
      expect(
        screen.getByRole('heading', { level: 2, name: tabs.appearance }),
      ).toBeInTheDocument();
      expect(screen.getByText(appearanceDescription)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: groups.theme })).toBeVisible();
      expect(
        screen.getByRole('region', { name: groups.writingCanvas }),
      ).toBeVisible();

      activateTab(tabs.editor);
      expect(
        screen.getByRole('heading', { level: 2, name: tabs.editor }),
      ).toBeInTheDocument();
      expect(screen.getByText(editorDescription)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: groups.editor })).toBeVisible();

      activateTab(tabs.images);
      expect(
        screen.getByRole('heading', { level: 2, name: tabs.images }),
      ).toBeInTheDocument();
      expect(screen.getByText(imagesDescription)).toBeInTheDocument();
      expect(screen.getByRole('region', { name: groups.images })).toBeVisible();
    },
  );

  it('uses controlled switches for every boolean setting and fires each callback once', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onAutoCheckUpdatesChange = vi.fn();
    const onCopyImagesToAssetsChange = vi.fn();
    const onFocusModeOnStartupChange = vi.fn();
    const onSidebarOpenOnStartupChange = vi.fn();
    renderSettings({
      language: 'en',
      onAutoCheckUpdatesChange,
      onCopyImagesToAssetsChange,
      onFocusModeOnStartupChange,
      onSidebarOpenOnStartupChange,
    });

    const updates = screen.getByRole('switch', {
      name: 'Check for updates when LumaMark starts',
    });
    expect(updates).toBeChecked();
    fireEvent.click(updates);
    expect(onAutoCheckUpdatesChange).toHaveBeenCalledTimes(1);
    expect(onAutoCheckUpdatesChange).toHaveBeenCalledWith(false);

    activateTab('Appearance');
    const sidebar = screen.getByRole('switch', {
      name: 'Expand sidebar on startup',
    });
    expect(sidebar).toBeChecked();
    fireEvent.click(sidebar);
    expect(onSidebarOpenOnStartupChange).toHaveBeenCalledTimes(1);
    expect(onSidebarOpenOnStartupChange).toHaveBeenCalledWith(false);

    activateTab('Editor');
    const focusMode = screen.getByRole('switch', {
      name: 'Enter focus mode on startup',
    });
    expect(focusMode).not.toBeChecked();
    fireEvent.click(focusMode);
    expect(onFocusModeOnStartupChange).toHaveBeenCalledTimes(1);
    expect(onFocusModeOnStartupChange).toHaveBeenCalledWith(true);

    activateTab('Images');
    const images = screen.getByRole('switch', {
      name: 'Copy inserted local images to the document asset folder',
    });
    expect(images).not.toBeChecked();
    fireEvent.click(images);
    expect(onCopyImagesToAssetsChange).toHaveBeenCalledTimes(1);
    expect(onCopyImagesToAssetsChange).toHaveBeenCalledWith(true);
  });

  it('uses radio groups for every exclusive setting and exposes visual option hooks', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onDefaultDisplayModeChange = vi.fn();
    const onLanguageChange = vi.fn();
    const onPageWidthChange = vi.fn();
    const onStartupBehaviorChange = vi.fn();
    const onThemeChange = vi.fn();
    renderSettings({
      language: 'en',
      onDefaultDisplayModeChange,
      onLanguageChange,
      onPageWidthChange,
      onStartupBehaviorChange,
      onThemeChange,
    });

    const languageGroup = screen.getByRole('radiogroup', { name: 'Language' });
    expect(
      within(languageGroup).getByRole('radio', { name: 'English' }),
    ).toBeChecked();
    fireEvent.click(
      within(languageGroup).getByRole('radio', { name: '简体中文' }),
    );
    expect(onLanguageChange).toHaveBeenCalledTimes(1);
    expect(onLanguageChange).toHaveBeenCalledWith('zh-CN');

    const startupGroup = screen.getByRole('radiogroup', {
      name: 'When LumaMark starts',
    });
    fireEvent.click(
      within(startupGroup).getByRole('radio', {
        name: 'Restore last file or workspace',
      }),
    );
    expect(onStartupBehaviorChange).toHaveBeenCalledTimes(1);
    expect(onStartupBehaviorChange).toHaveBeenCalledWith('restoreLastSession');

    activateTab('Appearance');
    const themeGroup = screen.getByRole('radiogroup', { name: 'Theme' });
    const darkTheme = within(themeGroup).getByRole('radio', { name: 'Dark' });
    expect(darkTheme).toHaveAttribute('data-value', 'dark');
    expect(darkTheme).not.toHaveAttribute('aria-pressed');
    fireEvent.click(darkTheme);
    expect(onThemeChange).toHaveBeenCalledTimes(1);
    expect(onThemeChange).toHaveBeenCalledWith('dark');

    const pageWidthGroup = screen.getByRole('radiogroup', {
      name: 'Page width',
    });
    const wide = within(pageWidthGroup).getByRole('radio', { name: 'Wide' });
    expect(wide).toHaveAttribute('data-value', 'wide');
    fireEvent.click(wide);
    expect(onPageWidthChange).toHaveBeenCalledTimes(1);
    expect(onPageWidthChange).toHaveBeenCalledWith('wide');

    activateTab('Editor');
    const displayModeGroup = screen.getByRole('radiogroup', {
      name: 'Default display mode',
    });
    fireEvent.click(
      within(displayModeGroup).getByRole('radio', { name: 'Source mode' }),
    );
    expect(onDefaultDisplayModeChange).toHaveBeenCalledTimes(1);
    expect(onDefaultDisplayModeChange).toHaveBeenCalledWith('source');
  });

  it('renders semantic previews only for theme and page-width choices', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    renderSettings({ language: 'en', pageWidth: 'standard', theme: 'system' });

    activateTab('Appearance');

    const themeGroup = screen.getByRole('radiogroup', { name: 'Theme' });
    const themeChoices = within(themeGroup).getAllByRole('radio');
    expect(themeChoices).toHaveLength(3);
    for (const choice of themeChoices) {
      expect(
        choice.querySelector('[data-lm-settings-theme-preview]'),
      ).not.toBeNull();
    }
    expect(
      within(themeGroup)
        .getByRole('radio', { name: 'System' })
        .querySelector('[data-preview="system"]'),
    ).not.toBeNull();

    const widthGroup = screen.getByRole('radiogroup', { name: 'Page width' });
    const widthChoices = within(widthGroup).getAllByRole('radio');
    expect(widthChoices).toHaveLength(4);
    for (const choice of widthChoices) {
      expect(
        choice.querySelector('[data-lm-settings-page-width-preview]'),
      ).not.toBeNull();
    }
    expect(
      within(widthGroup)
        .getByRole('radio', { name: 'Standard' })
        .querySelector('[data-preview="standard"]'),
    ).not.toBeNull();

    activateTab('General');
    expect(
      screen
        .getByRole('radiogroup', { name: 'Language' })
        .querySelector('[data-lm-settings-theme-preview]'),
    ).toBeNull();
  });

  it.each([
    {
      language: 'zh-CN' as const,
      settingsTitle: '设置',
      title: '清空最近文件',
      description: '确定清空最近文件列表吗？此操作不会删除磁盘上的文件。',
      cancel: '取消',
      confirm: '清空',
    },
    {
      language: 'en' as const,
      settingsTitle: 'Settings',
      title: 'Clear recent files',
      description:
        'Clear the recent files list? This does not delete files on disk.',
      cancel: 'Cancel',
      confirm: 'Clear',
    },
  ])(
    'uses a localized modal confirmation and restores focus in $language',
    async ({
      language,
      settingsTitle,
      title,
      description,
      cancel,
      confirm,
    }) => {
      useAppPreferencesStore.setState({ language });
      const onClearRecentFiles = vi.fn();
      renderSettings({ language, onClearRecentFiles });

      const settingsDialog = screen.getByRole('dialog', {
        name: settingsTitle,
      });
      const trigger = within(settingsDialog).getByRole('button', {
        name: title,
      });
      trigger.focus();
      fireEvent.click(trigger);

      const confirmation = await screen.findByRole('alertdialog', {
        name: title,
      });
      expect(confirmation).toHaveAccessibleDescription(description);
      const cancelButton = within(confirmation).getByRole('button', {
        name: cancel,
      });
      await waitFor(() => {
        expect(cancelButton).toHaveFocus();
      });
      expect(onClearRecentFiles).not.toHaveBeenCalled();

      fireEvent.keyDown(document, { key: 'Escape' });
      await waitFor(() => {
        expect(screen.queryByRole('alertdialog', { name: title })).toBeNull();
      });
      expect(settingsDialog).toBeVisible();
      expect(trigger).toHaveFocus();

      fireEvent.click(trigger);
      const reopened = await screen.findByRole('alertdialog', { name: title });
      fireEvent.click(within(reopened).getByRole('button', { name: confirm }));
      expect(onClearRecentFiles).toHaveBeenCalledTimes(1);
      expect(settingsDialog).toBeVisible();
      await waitFor(() => {
        expect(trigger).toHaveFocus();
      });
    },
  );

  it('changes the startup update preference from the general section', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onAutoCheckUpdatesChange = vi.fn();
    renderSettings({ language: 'en', onAutoCheckUpdatesChange });

    fireEvent.click(
      screen.getByRole('switch', {
        name: 'Check for updates when LumaMark starts',
      }),
    );

    expect(onAutoCheckUpdatesChange).toHaveBeenCalledWith(false);
  });

  it('exposes font zoom range semantics', () => {
    useAppPreferencesStore.setState({ language: 'zh-CN' });
    renderSettings({ fontZoomPercent: 120 });

    activateTab('外观');
    const zoom = screen.getByLabelText('字体缩放（%）');
    expect(zoom).toHaveAttribute('aria-valuenow', '120');
    expect(zoom).toHaveAttribute('aria-valuemin', '50');
    expect(zoom).toHaveAttribute('aria-valuemax', '250');
    expect(zoom).toHaveAttribute('step', '10');
  });

  it('keeps partial zoom input editable and commits only a valid step', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onFontZoomPercentChange = vi.fn();
    renderSettings({
      fontZoomPercent: 120,
      language: 'en',
      onFontZoomPercentChange,
    });

    activateTab('Appearance');
    const zoom = screen.getByLabelText('Font zoom (%)');
    fireEvent.change(zoom, { target: { value: '' } });
    expect(zoom).toHaveValue(null);
    expect(onFontZoomPercentChange).not.toHaveBeenCalled();

    fireEvent.change(zoom, { target: { value: '130' } });
    expect(onFontZoomPercentChange).toHaveBeenCalledWith(130);
  });

  it('changes zoom by one localized step per button press', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onFontZoomPercentChange = vi.fn();
    renderSettings({
      fontZoomPercent: 120,
      language: 'en',
      onFontZoomPercentChange,
    });

    activateTab('Appearance');
    fireEvent.click(screen.getByRole('button', { name: 'Increase font zoom' }));
    expect(onFontZoomPercentChange).toHaveBeenNthCalledWith(1, 130);
    expect(onFontZoomPercentChange).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Decrease font zoom' }));
    expect(onFontZoomPercentChange).toHaveBeenNthCalledWith(2, 110);
    expect(onFontZoomPercentChange).toHaveBeenCalledTimes(2);
  });

  it('clamps zoom steppers at the supported bounds', () => {
    useAppPreferencesStore.setState({ language: 'zh-CN' });
    const onFontZoomPercentChange = vi.fn();
    renderSettings({
      fontZoomPercent: 250,
      onFontZoomPercentChange,
    });

    activateTab('外观');
    const increase = screen.getByRole('button', { name: '增大字体缩放' });
    expect(increase).toBeDisabled();
    fireEvent.click(increase);
    expect(onFontZoomPercentChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '减小字体缩放' }));
    expect(onFontZoomPercentChange).toHaveBeenCalledTimes(1);
    expect(onFontZoomPercentChange).toHaveBeenCalledWith(240);
  });

  it('names each exclusive control as an accessible radio group', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    renderSettings({ language: 'en' });

    expect(
      screen.getByRole('radiogroup', { name: 'Language' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'When LumaMark starts' }),
    ).toBeInTheDocument();

    activateTab('Appearance');
    expect(
      screen.getByRole('radiogroup', { name: 'Theme' }),
    ).toBeInTheDocument();

    activateTab('Editor');
    expect(
      screen.getByRole('radiogroup', { name: 'Default display mode' }),
    ).toBeInTheDocument();
  });

  it('lists vertical sections in order with vertical orientation', () => {
    useAppPreferencesStore.setState({ language: 'zh-CN' });
    renderSettings();

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      '通用',
      '外观',
      '编辑器',
      '图片',
    ]);
    expect(tabs[0]?.closest('[aria-orientation="vertical"]')).not.toBeNull();
  });

  it.each([
    {
      language: 'zh-CN' as const,
      appearance: '外观',
      editor: '编辑器',
      fontZoom: '字体缩放（%）',
      sidebar: '启动时展开侧栏',
      livePreview: '实时预览',
      focusMode: '启动时进入专注模式',
      alert:
        'LumaMark 无法保存设置。请保持窗口打开，检查文件权限或释放磁盘空间，然后重试。',
    },
    {
      language: 'en' as const,
      appearance: 'Appearance',
      editor: 'Editor',
      fontZoom: 'Font zoom (%)',
      sidebar: 'Expand sidebar on startup',
      livePreview: 'Live preview',
      focusMode: 'Enter focus mode on startup',
      alert:
        'LumaMark could not save settings. Keep this window open, check file permissions or free disk space, then retry.',
    },
  ])(
    'exposes new setting controls and persistence alerts in $language',
    ({
      language,
      appearance,
      editor,
      fontZoom,
      sidebar,
      livePreview,
      focusMode,
      alert,
    }) => {
      useAppPreferencesStore.setState({ language });
      renderSettings({
        language,
        settingsWriteState: {
          code: 'settings.write_failed',
          status: 'failed',
        },
      });

      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByRole('alert')).toHaveTextContent(alert);

      activateTab(appearance);
      expect(screen.getByLabelText(fontZoom)).toBeInTheDocument();
      expect(
        screen.getByRole('switch', { name: sidebar }),
      ).toBeInTheDocument();

      activateTab(editor);
      expect(screen.getByRole('alert')).toHaveTextContent(alert);
      expect(
        screen.getByRole('radio', { name: livePreview }),
      ).toBeChecked();
      expect(
        screen.getByRole('switch', { name: focusMode }),
      ).toBeInTheDocument();
    },
  );

  it('shows one settings persistence alert when an update preference write fails', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    renderSettings({
      language: 'en',
      settingsWriteState: {
        code: 'settings.write_failed',
        status: 'failed',
      },
    });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'LumaMark could not save settings. Keep this window open, check file permissions or free disk space, then retry.',
    );
  });

  it('shows a non-retryable warning when legacy storage migration cannot be read', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    renderSettings({
      language: 'en',
      settingsWriteState: {
        code: 'settings.legacy_migration_failed',
        status: 'failed',
      },
    });

    expect(screen.getByRole('alert')).toHaveAttribute(
      'data-error-code',
      'settings.legacy_migration_failed',
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'LumaMark could not read preferences from an older installation. Current settings remain usable; check WebView storage access, then restart the app to retry migration.',
    );
    expect(
      screen.queryByRole('button', { name: 'Retry saving' }),
    ).toBeNull();
  });

  it.each([
    {
      code: 'window.close_listener_failed' as const,
      language: 'en' as const,
      message:
        'LumaMark could not register the native close safeguard. Save your settings, use the title-bar Close button, then restart the app.',
    },
    {
      code: 'window.destroy_failed' as const,
      language: 'zh-CN' as const,
      message:
        '设置已保存，但 LumaMark 无法关闭窗口。请再次尝试关闭；若仍失败，请使用系统任务管理器。',
    },
  ])(
    'shows the actionable $code close failure in $language',
    ({ code, language, message }) => {
      useAppPreferencesStore.setState({ language });
      renderSettings({ closeErrorCode: code, language });

      expect(screen.getByRole('alert')).toHaveAttribute(
        'data-error-code',
        code,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(message);
    },
  );

  it.each([
    {
      language: 'en' as const,
      props: {
        settingsRecoveryState: { kind: 'invalidFields' as const },
      },
      message:
        'Some invalid setting values were reset to safe defaults. Review your settings before continuing.',
    },
    {
      language: 'zh-CN' as const,
      props: {
        settingsRecoveryState: {
          backupPath: 'C:/LumaMark/settings.corrupt-1.json',
          kind: 'corruption' as const,
        },
      },
      message:
        '设置文件已损坏，LumaMark 已恢复默认值。原文件已备份到 C:/LumaMark/settings.corrupt-1.json。请检查设置后再继续。',
    },
    {
      language: 'en' as const,
      props: {
        settingsLoadState: {
          code: 'settings.read_failed',
          status: 'readFailed' as const,
        },
      },
      message:
        'LumaMark could not read settings. Saving is blocked to protect the existing file. Check file permissions, then restart the app.',
    },
    {
      language: 'zh-CN' as const,
      props: {
        settingsLoadState: {
          code: 'settings.unsupported_version',
          status: 'unsupportedVersion' as const,
        },
      },
      message:
        '此设置文件来自更新版本的 LumaMark。为避免覆盖，当前会话已禁止保存设置。请使用兼容版本打开。',
    },
  ])('renders one actionable structured notice for $message', ({ language, message, props }) => {
    useAppPreferencesStore.setState({ language });
    renderSettings({ language, ...props });

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent(message);
  });

  it('retries the retained canonical snapshot from the write failure notice', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onRetrySettingsWrite = vi.fn();
    renderSettings({
      language: 'en',
      onRetrySettingsWrite,
      settingsWriteState: {
        code: 'settings.write_failed',
        status: 'failed',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Retry saving' }));
    expect(onRetrySettingsWrite).toHaveBeenCalledTimes(1);
  });

  it('offers following the system theme as a first-class appearance choice', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onThemeChange = vi.fn();
    renderSettings({ language: 'en', onThemeChange, theme: 'system' });

    activateTab('Appearance');
    const system = screen.getByRole('radio', { name: 'System' });
    const light = screen.getByRole('radio', { name: 'Light' });
    expect(system).toBeChecked();
    fireEvent.click(light);
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });
});
