import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAppStore } from './appStore';

describe('useAppStore.setDirty', () => {
  it('does not rerender shell-driving dirty selectors after the first unsaved transition', () => {
    useAppStore.setState({
      dirty: false,
      dirtyRevision: 4,
      statusKey: 'status.ready',
    });

    let shellRenders = 0;
    function ShellProbe() {
      const dirty = useAppStore((state) => state.dirty);
      const statusKey = useAppStore((state) => state.statusKey);
      shellRenders += 1;
      return (
        <span>
          {dirty ? 'dirty' : 'clean'}:{statusKey}
        </span>
      );
    }

    render(<ShellProbe />);
    expect(shellRenders).toBe(1);

    act(() => {
      useAppStore.getState().setDirty(true);
    });
    expect(shellRenders).toBe(2);

    act(() => {
      useAppStore.getState().setDirty(true);
      useAppStore.getState().setDirty(true);
    });
    expect(shellRenders).toBe(2);
    expect(useAppStore.getState().dirtyRevision).toBe(7);
  });
});
