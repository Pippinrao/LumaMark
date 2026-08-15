import { useTranslation } from 'react-i18next';
import type { WindowControlErrorCode } from '../../services/window/windowControls';
import type {
  SettingsLoadState,
  SettingsRecoveryState,
  SettingsWriteState,
} from './settingsStore';

type SettingsNoticesProps = {
  closeErrorCode: WindowControlErrorCode | null;
  onRetrySettingsWrite: () => void;
  settingsLoadState: SettingsLoadState;
  settingsRecoveryState: SettingsRecoveryState;
  settingsWriteState: SettingsWriteState;
};

export function SettingsNotices({
  closeErrorCode,
  onRetrySettingsWrite,
  settingsLoadState,
  settingsRecoveryState,
  settingsWriteState,
}: SettingsNoticesProps) {
  const { t } = useTranslation();

  return (
    <>
      {closeErrorCode ? (
        <p
          className="lm-setting-error"
          data-error-code={closeErrorCode}
          role="alert"
        >
          {t(
            closeErrorCode === 'window.close_listener_failed'
              ? 'settings.closeListenerFailed'
              : 'settings.destroyFailed',
          )}
        </p>
      ) : null}
      {settingsLoadState.status === 'readFailed' ? (
        <p
          className="lm-setting-error"
          data-error-code={settingsLoadState.code}
          role="alert"
        >
          {t('settings.readFailed')}
        </p>
      ) : null}
      {settingsLoadState.status === 'unsupportedVersion' ? (
        <p
          className="lm-setting-error"
          data-error-code={settingsLoadState.code}
          role="alert"
        >
          {t('settings.unsupportedVersion')}
        </p>
      ) : null}
      {settingsRecoveryState.kind === 'invalidFields' ? (
        <p className="lm-setting-error" role="alert">
          {t('settings.invalidFieldsRecovered')}
        </p>
      ) : null}
      {settingsRecoveryState.kind === 'corruption' ? (
        <p className="lm-setting-error" role="alert">
          {settingsRecoveryState.backupPath
            ? t('settings.corruptionRecoveredWithBackup', {
                backupPath: settingsRecoveryState.backupPath,
              })
            : t('settings.corruptionRecovered')}
        </p>
      ) : null}
      {settingsWriteState.status === 'failed' ? (
        <div
          className="lm-setting-error lm-settings-persistence-notice"
          data-error-code={settingsWriteState.code}
          role="alert"
        >
          <span>
            {t(
              settingsWriteState.code === 'settings.legacy_migration_failed'
                ? 'settings.legacyMigrationFailed'
                : 'settings.writeFailed',
            )}
          </span>
          {settingsWriteState.code !== 'settings.legacy_migration_failed' ? (
            <button
              className="lm-button"
              onClick={onRetrySettingsWrite}
              type="button"
            >
              {t('settings.retrySave')}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
