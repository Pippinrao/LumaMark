import { useTranslation } from 'react-i18next';
import type { OutlineHeading } from './outlineParser';

type OutlinePanelProps = {
  headings: readonly OutlineHeading[];
  onSelectHeading: (heading: OutlineHeading) => void;
};

export function OutlinePanel({
  headings,
  onSelectHeading,
}: OutlinePanelProps) {
  const { t } = useTranslation();

  return (
    <section className="lm-outline" aria-label={t('outline.title')}>
      <div className="lm-sidebar-section-header">
        <span>{t('outline.title')}</span>
      </div>
      {headings.length ? (
        <ol className="lm-outline-list">
          {headings.map((heading) => (
            <li key={`${heading.from}:${heading.to}`}>
              <button
                type="button"
                className="lm-outline-item"
                style={{ paddingLeft: `${(heading.level - 1) * 12 + 8}px` }}
                onClick={() => {
                  onSelectHeading(heading);
                }}
              >
                {heading.text}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <div className="lm-sidebar-empty">{t('outline.empty')}</div>
      )}
    </section>
  );
}
