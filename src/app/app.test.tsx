import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { installResizeObserverStub } from '../test/resizeObserverStub';
import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    installResizeObserverStub();
  });

  it('renders the accessible application title', async () => {
    render(<App />);

    expect(
      await screen.findByRole('heading', { name: /lumamark/i }),
    ).toBeInTheDocument();
  });
});
