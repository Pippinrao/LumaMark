import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSidebar } from './WorkspaceSidebar';

describe('WorkspaceSidebar tabs', () => {
  afterEach(cleanup);

  it('mounts outline content when switching from the files tab', () => {
    render(
      <WorkspaceSidebar
        fileTree={<div data-testid="files-body">files</div>}
        labels={{
          files: 'Files',
          outline: 'Outline',
          sidebar: 'Sidebar',
        }}
        outline={<div data-testid="outline-body">outline</div>}
      />,
    );

    expect(screen.getByTestId('files-body')).toBeInTheDocument();
    expect(screen.queryByTestId('outline-body')).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Outline' }));

    expect(screen.getByTestId('outline-body')).toBeInTheDocument();
    expect(screen.queryByTestId('files-body')).not.toBeInTheDocument();
  });

  it('reports the selected tab when switching between files and outline', () => {
    const onTabChange = vi.fn();
    render(
      <WorkspaceSidebar
        fileTree={<div data-testid="files-body">files</div>}
        labels={{
          files: 'Files',
          outline: 'Outline',
          sidebar: 'Sidebar',
        }}
        onTabChange={onTabChange}
        outline={<div data-testid="outline-body">outline</div>}
      />,
    );

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Outline' }));

    expect(onTabChange).toHaveBeenCalledWith('outline');
  });
});
