import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';

export function AppShell() {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const statusKey = useAppStore((state) => state.statusKey);
  const toggleLanguage = useAppStore((state) => state.toggleLanguage);
  const toggleTheme = useAppStore((state) => state.toggleTheme);

  return (
    <div className="lm-app-shell" data-testid="app-shell">
      <header className="lm-shell-header">
        <div className="lm-title-group">
          <h1>{t('app.name')}</h1>
          <span className="lm-document-title">{t('app.emptyTitle')}</span>
        </div>

        <nav className="lm-command-bar" aria-label={t('app.toolbarLabel')}>
          <button type="button">{t('command.openFile')}</button>
          <button type="button">{t('command.save')}</button>
          <button type="button">{t('command.saveAs')}</button>
          <button type="button" onClick={toggleTheme}>
            {t('command.toggleTheme')}
          </button>
          <button type="button" onClick={toggleLanguage}>
            {t('command.toggleLanguage')}
          </button>
        </nav>
      </header>

      <div className="lm-shell-body">
        {sidebarOpen ? (
          <aside className="lm-sidebar" aria-label={t('app.sidebarLabel')}>
            <div className="lm-sidebar-item">{t('app.emptyTitle')}</div>
          </aside>
        ) : null}

        <main
          className="lm-editor-surface"
          data-testid="editor-host"
          aria-label={t('app.editorLabel')}
        >
          <section
            className="lm-editor-placeholder"
            aria-labelledby="lm-editor-title"
          >
            <h2 id="lm-editor-title">{t('app.emptyTitle')}</h2>
          </section>
        </main>
      </div>

      <footer className="lm-status-bar">
        <span role="status">{t(statusKey)}</span>
      </footer>
    </div>
  );
}
