import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Save } from 'lucide-react';
import { I18nProvider } from '../../app/providers/I18nProvider';
import type { CommandMenuInvocation } from '../commands/commandTypes';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  it('does not run a disabled command', () => {
    const onCommandSelect = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <I18nProvider>
        <CommandPalette
          commands={[
            {
              disabled: true,
              icon: Save,
              id: 'save',
              invocation: { action: 'save', kind: 'action' },
              keywords: [],
              label: '保存',
            },
          ]}
          onCommandSelect={onCommandSelect}
          onOpenChange={onOpenChange}
          open
        />
      </I18nProvider>,
    );

    const command = screen.getByRole('option', { name: '保存' });

    expect(command).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(command);
    expect(onCommandSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('selects a typed invocation instead of an arbitrary callback', () => {
    const invocation: CommandMenuInvocation = {
      action: 'save',
      kind: 'action',
    };
    const onCommandSelect = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <I18nProvider>
        <CommandPalette
          commands={[
            { icon: Save, id: 'save', invocation, keywords: [], label: '保存' },
          ]}
          onCommandSelect={onCommandSelect}
          onOpenChange={onOpenChange}
          open
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('option', { name: '保存' }));

    expect(onCommandSelect).toHaveBeenCalledWith(invocation);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
