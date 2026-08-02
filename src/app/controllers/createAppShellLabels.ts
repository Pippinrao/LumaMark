import type { TFunction } from 'i18next';
import type { DocumentStatistics } from '../../editor/metrics/documentStatistics';
import type { StatusKey } from '../stores/appStore';

type CreateAppShellLabelsOptions = {
  documentStatistics: DocumentStatistics;
  statusKey: StatusKey;
  t: TFunction;
};

export function createTableShortcutLabels(t: TFunction) {
  return {
    copy: t('shortcut.table.copy'),
    delete: t('shortcut.table.delete'),
  };
}

export function createAppShellLabels({
  documentStatistics,
  statusKey,
  t,
}: CreateAppShellLabelsOptions) {
  return {
    editor: t('app.editorLabel'),
    focusMode: {
      exit: t('command.exitFocusMode'),
    },
    sidebar: {
      files: t('sidebar.files'),
      outline: t('outline.title'),
      sidebar: t('app.sidebarLabel'),
    },
    status: {
      dirtyIndicator: t('status.dirtyIndicator'),
      statistics: t('status.documentStatistics', documentStatistics),
      status: t(statusKey),
    },
    topChrome: {
      appName: t('app.name'),
      close: t('window.close'),
      controls: t('window.controls'),
      maximize: t('window.maximize'),
      minimize: t('window.minimize'),
      restore: t('window.restore'),
    },
  };
}
