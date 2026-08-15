import { Command } from 'cmdk';
import { useTranslation } from 'react-i18next';
import type {
  CommandMenuInvocation,
  CommandModel,
} from '../commands/commandTypes';

export type AppCommand = CommandModel;

type CommandPaletteProps = {
  commands: readonly AppCommand[];
  onCommandSelect: (invocation: CommandMenuInvocation) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function CommandPalette({
  commands,
  onCommandSelect,
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
                disabled={command.disabled}
                keywords={command.keywords}
                value={command.label}
                onSelect={() => {
                  onCommandSelect(command.invocation);
                  onOpenChange(false);
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
