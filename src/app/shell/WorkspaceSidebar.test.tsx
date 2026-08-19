import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
