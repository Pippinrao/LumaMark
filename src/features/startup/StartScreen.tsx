import { FilePlus2, FileText, Folder, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RecentFile } from '../recent-files/recentFilesStore';
import type { RecentWorkspace } from './startupStore';

type StartScreenProps = {
  onNewDocument: () => void;
  onOpenFile: () => void;
  onOpenRecentFile: (path: string) => void;
  onOpenRecentWorkspace: (path: string) => void;
  onOpenWorkspace: () => void;
  recentFiles: readonly RecentFile[];
  recentFilesPersistenceError?: boolean;
  recentWorkspaces: readonly RecentWorkspace[];
  startupPersistenceError?: boolean;
};

export function StartScreen({
  onNewDocument,
  onOpenFile,
  onOpenRecentFile,
  onOpenRecentWorkspace,
  onOpenWorkspace,
  recentFiles,
  recentFilesPersistenceError = false,
  recentWorkspaces,
  startupPersistenceError = false,
}: StartScreenProps) {
  const { t } = useTranslation();

  return (
    <main aria-label={t('startup.title')} className="lm-start-screen">
      <div className="lm-start-screen-content">
        {startupPersistenceError ? (
          <p className="lm-start-error" role="alert">
            {t('settings.startupPersistenceError')}
          </p>
        ) : null}
        {recentFilesPersistenceError ? (
          <p className="lm-start-error" role="alert">
            {t('settings.recentFilesPersistenceError')}
          </p>
        ) : null}
        <header className="lm-start-screen-header">
          <h1>{t('app.name')}</h1>
          <p>{t('startup.description')}</p>
        </header>
        <div className="lm-start-actions">
          <button type="button" onClick={onNewDocument}>
            <FilePlus2 aria-hidden="true" size={20} />
            <span>{t('startup.newDocument')}</span>
          </button>
          <button type="button" onClick={onOpenFile}>
            <FileText aria-hidden="true" size={20} />
            <span>{t('startup.openFile')}</span>
          </button>
          <button type="button" onClick={onOpenWorkspace}>
            <FolderOpen aria-hidden="true" size={20} />
            <span>{t('workspace.open')}</span>
          </button>
        </div>
        <div className="lm-start-recents">
          <RecentSection
            emptyLabel={t('recentFiles.empty')}
            items={recentFiles}
            label={t('recentFiles.title')}
            onOpen={onOpenRecentFile}
            openLabel={(item) => t('recentFiles.openFile', item)}
            renderIcon={() => <FileText aria-hidden="true" size={16} />}
          />
          <RecentSection
            emptyLabel={t('recentWorkspaces.empty')}
            items={recentWorkspaces}
            label={t('recentWorkspaces.title')}
            onOpen={onOpenRecentWorkspace}
            openLabel={(item) => t('recentWorkspaces.openWorkspace', item)}
            renderIcon={() => <Folder aria-hidden="true" size={16} />}
          />
        </div>
      </div>
    </main>
  );
}

type RecentItem = { name: string; path: string };

function RecentSection<T extends RecentItem>({
  emptyLabel,
  items,
  label,
  onOpen,
  openLabel,
  renderIcon,
}: {
  emptyLabel: string;
  items: readonly T[];
  label: string;
  onOpen: (path: string) => void;
  openLabel: (item: T) => string;
  renderIcon: () => React.ReactNode;
}) {
  return (
    <section aria-label={label} className="lm-start-recent-section">
      <h2>{label}</h2>
      {items.length ? (
        <div className="lm-start-recent-list">
          {items.map((item) => (
            <button
              aria-label={openLabel(item)}
              key={item.path}
              onClick={() => { onOpen(item.path); }}
              title={item.path}
              type="button"
            >
              {renderIcon()}
              <span>{item.name}</span>
              <small>{item.path}</small>
            </button>
          ))}
        </div>
      ) : (
        <p className="lm-start-empty">{emptyLabel}</p>
      )}
    </section>
  );
}
