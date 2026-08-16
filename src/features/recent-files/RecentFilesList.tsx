import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { areFilePathsEqual } from '../../services/files/filePathIdentity';
import type { RecentFile } from './recentFilesStore';

type RecentFilesListProps = {
  files: readonly RecentFile[];
  onOpenFile: (path: string) => void;
  selectedPath?: string;
};

export function RecentFilesList({
  files,
  onOpenFile,
  selectedPath,
}: RecentFilesListProps) {
  const { t } = useTranslation();

  if (!files.length) {
    return null;
  }

  return (
    <section className="lm-recent-files" aria-label={t('recentFiles.title')}>
      <div className="lm-recent-files-header">{t('recentFiles.title')}</div>
      <div className="lm-recent-files-list">
        {files.map((file) => {
          const selected = Boolean(
            selectedPath && areFilePathsEqual(file.path, selectedPath),
          );
          return (
            <button
              aria-current={selected ? true : undefined}
              aria-label={t('recentFiles.openFile', {
                name: file.name,
                path: file.path,
              })}
              className={
                selected ? 'lm-recent-file lm-recent-file-current' : 'lm-recent-file'
              }
              key={file.path}
              onClick={() => {
                onOpenFile(file.path);
              }}
              title={file.path}
              type="button"
            >
              <FileText aria-hidden="true" size={15} />
              <span>{file.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
