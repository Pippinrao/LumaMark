import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the accessible application title', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /lumamark/i }),
    ).toBeInTheDocument();
  });
});
