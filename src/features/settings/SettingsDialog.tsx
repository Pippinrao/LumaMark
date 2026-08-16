import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  MAX_SETTINGS_FONT_ZOOM_PERCENT,
  MIN_SETTINGS_FONT_ZOOM_PERCENT,
  SETTINGS_FONT_ZOOM_STEP_PERCENT,
  type SettingsEquationNumbering,
  type SettingsMathSyntaxMode,
  type SettingsOpenWindowMode,
  type SettingsTheme,
} from '../../services/settings/settingsTypes';
import type { WindowControlErrorCode } from '../../services/window/windowControls';
import type { AppLanguage } from '../../shared/i18n';
import type { EditorPageWidth } from '../reading-appearance/readingAppearanceStore';
import type { StartupBehavior } from '../startup/startupStore';
import {
  AppearanceSettingsPage,
  EditorSettingsPage,
  GeneralSettingsPage,
  ImagesSettingsPage,
  type SettingsDisplayMode,
} from './SettingsPages';
import { TrashSettingsPage } from '../trash/TrashSettingsPage';
import { useTrashSettings } from '../trash/useTrashSettings';
import {
  isSettingsSection,
  SettingsNavigation,
  type SettingsSection,
} from './SettingsNavigation';
import { SettingsNotices } from './SettingsNotices';
import {
  useSettingsStore,
  type SettingsLoadState,
  type SettingsRecoveryState,
  type SettingsWriteState,
} from './settingsStore';
import './settingsDialog.css';

type SettingsDialogProps = {
  autoCheckUpdates: boolean;
  autosaveEnabled: boolean;
  closeErrorCode: WindowControlErrorCode | null;
  copyImagesToAssets: boolean;
  defaultDisplayMode: SettingsDisplayMode;
  focusModeOnStartup: boolean;
  fontZoomPercent: number;
  language: AppLanguage;
  loadUnsavedDocument: (text: string) => void;
  mathEquationNumbering: SettingsEquationNumbering;
  mathPhysicsEnabled: boolean;
  mathSyntaxMode: SettingsMathSyntaxMode;
  plantumlEnabled: boolean;
  onAutoCheckUpdatesChange: (autoCheckUpdates: boolean) => void;
  onAutosaveEnabledChange: (autosaveEnabled: boolean) => void;
  onClearRecentFiles: () => void;
  onCopyImagesToAssetsChange: (copyImagesToAssets: boolean) => void;
  onDefaultDisplayModeChange: (mode: SettingsDisplayMode) => void;
  onFocusModeOnStartupChange: (focusModeOnStartup: boolean) => void;
  onFontZoomPercentChange: (fontZoomPercent: number) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onMathEquationNumberingChange: (
    equationNumbering: SettingsEquationNumbering,
  ) => void;
  onMathPhysicsEnabledChange: (physicsEnabled: boolean) => void;
  onMathSyntaxModeChange: (syntaxMode: SettingsMathSyntaxMode) => void;
  onPlantumlEnabledChange: (plantumlEnabled: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onPageWidthChange: (pageWidth: EditorPageWidth) => void;
  onRetrySettingsWrite: () => void;
  onReturnFocus: () => void;
  onSidebarOpenOnStartupChange: (sidebarOpenOnStartup: boolean) => void;
  onStartupBehaviorChange: (startupBehavior: StartupBehavior) => void;
  onThemeChange: (theme: SettingsTheme) => void;
  open: boolean;
  pageWidth: EditorPageWidth;
  pageWidthPersistenceError: boolean;
  recentFilesPersistenceError: boolean;
  settingsLoadState: SettingsLoadState;
  settingsRecoveryState: SettingsRecoveryState;
  settingsWriteState: SettingsWriteState;
  sidebarOpenOnStartup: boolean;
  startupBehavior: StartupBehavior;
  startupPersistenceError: boolean;
  theme: SettingsTheme;
};

export function SettingsDialog({
  autoCheckUpdates,
  autosaveEnabled,
  closeErrorCode,
  copyImagesToAssets,
  defaultDisplayMode,
  focusModeOnStartup,
  fontZoomPercent,
  language,
  loadUnsavedDocument,
  mathEquationNumbering,
  mathPhysicsEnabled,
  mathSyntaxMode,
  plantumlEnabled,
  onAutoCheckUpdatesChange,
  onAutosaveEnabledChange,
  onClearRecentFiles,
  onCopyImagesToAssetsChange,
  onDefaultDisplayModeChange,
  onFocusModeOnStartupChange,
  onFontZoomPercentChange,
  onLanguageChange,
  onMathEquationNumberingChange,
  onMathPhysicsEnabledChange,
  onMathSyntaxModeChange,
  onPlantumlEnabledChange,
  onOpenChange,
  onPageWidthChange,
  onRetrySettingsWrite,
  onReturnFocus,
  onSidebarOpenOnStartupChange,
  onStartupBehaviorChange,
  onThemeChange,
  open,
  pageWidth,
  pageWidthPersistenceError,
  recentFilesPersistenceError,
  settingsLoadState,
  settingsRecoveryState,
  settingsWriteState,
  sidebarOpenOnStartup,
  startupBehavior,
  startupPersistenceError,
  theme,
}: SettingsDialogProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('general');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const openWindowMode = useSettingsStore(
    (state) => state.settings.general.openWindowMode,
  );
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const trash = useTrashSettings({
    enabled: activeSection === 'trash',
    loadUnsavedDocument,
    onRestored: () => onOpenChange(false),
  });
  const clearConfirmOpenRef = useRef(false);
  const [fontZoomEdit, setFontZoomEdit] = useState<{
    base: number;
    value: string;
  } | null>(null);
  const fontZoomDraft =
    fontZoomEdit?.base === fontZoomPercent
      ? fontZoomEdit.value
      : String(fontZoomPercent);

  const closeClearRecentFilesDialog = () => {
    setClearConfirmOpen(false);
    queueMicrotask(() => {
      clearConfirmOpenRef.current = false;
    });
  };

  const handleFontZoomDraftChange = (draft: string) => {
    setFontZoomEdit({ base: fontZoomPercent, value: draft });
    const next = Number(draft);
    if (
      draft !== '' &&
      Number.isInteger(next) &&
      next >= MIN_SETTINGS_FONT_ZOOM_PERCENT &&
      next <= MAX_SETTINGS_FONT_ZOOM_PERCENT &&
      next % SETTINGS_FONT_ZOOM_STEP_PERCENT === 0
    ) {
      onFontZoomPercentChange(next);
    }
  };

  const handleFontZoomStep = (next: number) => {
    setFontZoomEdit(null);
    onFontZoomPercentChange(next);
  };

  const handleOpenWindowModeChange = (mode: SettingsOpenWindowMode) => {
    updateSettings((current) => ({
      ...current,
      general: { ...current.general, openWindowMode: mode },
    }));
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lm-dialog-overlay" />
        <Dialog.Content
          className="lm-settings-dialog lm-settings-dialog-vertical"
          data-lm-window-interactive=""
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onReturnFocus();
          }}
          onEscapeKeyDown={(event) => {
            if (clearConfirmOpenRef.current) {
              event.preventDefault();
              closeClearRecentFilesDialog();
            }
          }}
        >
          <div className="lm-dialog-title-row">
            <Dialog.Title>{t('settings.title')}</Dialog.Title>
            <Dialog.Close className="lm-icon-button" aria-label={t('dialog.close')}>
              <X aria-hidden="true" size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="lm-dialog-description">
            {t('settings.description')}
          </Dialog.Description>
          <SettingsNotices
            closeErrorCode={closeErrorCode}
            onRetrySettingsWrite={onRetrySettingsWrite}
            settingsLoadState={settingsLoadState}
            settingsRecoveryState={settingsRecoveryState}
            settingsWriteState={settingsWriteState}
          />
          <Tabs.Root
            className="lm-settings-tabs lm-settings-tabs-vertical"
            onValueChange={(value) => {
              if (isSettingsSection(value)) {
                setActiveSection(value);
              }
            }}
            orientation="vertical"
            value={activeSection}
          >
            <SettingsNavigation />
            <div className="lm-settings-page-container">
              <GeneralSettingsPage
                autoCheckUpdates={autoCheckUpdates}
                clearRecentFilesOpen={clearConfirmOpen}
                language={language}
                onAutoCheckUpdatesChange={onAutoCheckUpdatesChange}
                onClearRecentFiles={onClearRecentFiles}
                onClearRecentFilesEscape={closeClearRecentFilesDialog}
                onClearRecentFilesOpenChange={(nextOpen) => {
                  clearConfirmOpenRef.current = nextOpen;
                  setClearConfirmOpen(nextOpen);
                }}
                onLanguageChange={onLanguageChange}
                onOpenWindowModeChange={handleOpenWindowModeChange}
                onStartupBehaviorChange={onStartupBehaviorChange}
                openWindowMode={openWindowMode}
                recentFilesPersistenceError={recentFilesPersistenceError}
                startupBehavior={startupBehavior}
                startupPersistenceError={startupPersistenceError}
              />
              <AppearanceSettingsPage
                fontZoomDraft={fontZoomDraft}
                fontZoomPercent={fontZoomPercent}
                onFontZoomBlur={() => {
                  setFontZoomEdit(null);
                }}
                onFontZoomDraftChange={handleFontZoomDraftChange}
                onFontZoomPercentChange={handleFontZoomStep}
                onPageWidthChange={onPageWidthChange}
                onSidebarOpenOnStartupChange={
                  onSidebarOpenOnStartupChange
                }
                onThemeChange={onThemeChange}
                pageWidth={pageWidth}
                pageWidthPersistenceError={pageWidthPersistenceError}
                sidebarOpenOnStartup={sidebarOpenOnStartup}
                theme={theme}
              />
              <EditorSettingsPage
                autosaveEnabled={autosaveEnabled}
                defaultDisplayMode={defaultDisplayMode}
                focusModeOnStartup={focusModeOnStartup}
                mathEquationNumbering={mathEquationNumbering}
                mathPhysicsEnabled={mathPhysicsEnabled}
                mathSyntaxMode={mathSyntaxMode}
                plantumlEnabled={plantumlEnabled}
                onAutosaveEnabledChange={onAutosaveEnabledChange}
                onDefaultDisplayModeChange={onDefaultDisplayModeChange}
                onFocusModeOnStartupChange={onFocusModeOnStartupChange}
                onMathEquationNumberingChange={onMathEquationNumberingChange}
                onMathPhysicsEnabledChange={onMathPhysicsEnabledChange}
                onMathSyntaxModeChange={onMathSyntaxModeChange}
                onPlantumlEnabledChange={onPlantumlEnabledChange}
              />
              <ImagesSettingsPage
                copyImagesToAssets={copyImagesToAssets}
                onCopyImagesToAssetsChange={onCopyImagesToAssetsChange}
              />
              <TrashSettingsPage
                emptyBusy={trash.emptyBusy}
                entries={trash.entries}
                loadError={trash.loadError}
                onEmpty={() => {
                  void trash.onEmpty();
                }}
                onPreview={(id) => {
                  void trash.onPreview(id);
                }}
                onRemove={(id) => {
                  void trash.onRemove(id);
                }}
                onRestore={(id) => {
                  void trash.onRestore(id);
                }}
                preview={trash.preview}
                previewBusy={trash.previewBusy}
                restoreBusyId={trash.restoreBusyId}
              />
            </div>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
