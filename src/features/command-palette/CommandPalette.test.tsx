import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Save } from 'lucide-react';
import { I18nProvider } from '../../app/providers/I18nProvider';
import { CommandPalette } from './CommandPalette';

describe('CommandPalette', () => {
  it('does not run a disabled command', () => {
    const run = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <I18nProvider>
        <CommandPalette
          commands={[
            {
              disabled: true,
              icon: Save,
              id: 'save',
              label: '保存',
              run,
            },
          ]}
          onCommandSelect={run}
          onOpenChange={onOpenChange}
          open
        />
      </I18nProvider>,
    );

    const command = screen.getByRole('option', { name: '保存' });

    expect(command).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(command);
    expect(run).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
