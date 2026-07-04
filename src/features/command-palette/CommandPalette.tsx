import { Command } from 'cmdk';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export type AppCommand = {
  id: string;
  icon: LucideIcon;
  keywords?: string[];
  label: string;
  run: () => void | Promise<void>;
  shortcut?: string;
};

type CommandPaletteProps = {
  commands: readonly AppCommand[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function CommandPalette({
  commands,
  onOpenChange,
  open,
}: CommandPaletteProps) {
  const { t } = useTranslation();

  return (
    <Command.Dialog
      contentClassName="lm-command-palette"
      label={t('commandPalette.title')}
      loop
      onOpenChange={onOpenChange}
      open={open}
      overlayClassName="lm-dialog-overlay"
    >
      <Command.Input
        autoFocus
        className="lm-command-palette-input"
        placeholder={t('commandPalette.searchPlaceholder')}
      />
      <Command.List className="lm-command-palette-list">
        <Command.Empty className="lm-command-palette-empty">
          {t('commandPalette.empty')}
        </Command.Empty>
        <Command.Group heading={t('commandPalette.groupGeneral')}>
          {commands.map((command) => {
            const Icon = command.icon;

            return (
              <Command.Item
                key={command.id}
                className="lm-command-palette-item"
                keywords={command.keywords}
                value={command.label}
                onSelect={() => {
                  onOpenChange(false);
                  void command.run();
                }}
              >
                <Icon size={16} aria-hidden="true" />
                <span>{command.label}</span>
                {command.shortcut ? (
                  <kbd className="lm-command-shortcut">{command.shortcut}</kbd>
                ) : null}
              </Command.Item>
            );
          })}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
