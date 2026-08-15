import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../../app/providers/I18nProvider';
import { useAppPreferencesStore } from '../../app/stores/appPreferencesStore';
import { DiscardChangesDialog } from './DiscardChangesDialog';

describe('DiscardChangesDialog close choices', () => {
  afterEach(() => {
    cleanup();
    useAppPreferencesStore.setState({ language: 'zh-CN' });
  });

  it('offers save, discard, and cancel when a save handler is provided', () => {
    useAppPreferencesStore.setState({ language: 'en' });
    const onConfirm = vi.fn();
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <I18nProvider>
        <DiscardChangesDialog
          descriptionKey="closeDocument.description"
          onConfirm={onConfirm}
          onOpenChange={onOpenChange}
          onReturnFocus={vi.fn()}
          onSave={onSave}
          open
          saveKey="closeDocument.save"
          titleKey="closeDocument.title"
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalled();
  });
});
