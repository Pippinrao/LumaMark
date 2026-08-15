import { afterEach, describe, expect, it } from 'vitest';

import {
  isMenuDebugEnabled,
  setMenuDebugEnabled,
} from './menuInteractionLog';

describe('menuInteractionLog storage access', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );

  afterEach(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    }
  });

  it('uses the document browser storage without touching Node localStorage accessors', () => {
    let nodeAccessorReads = 0;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        nodeAccessorReads += 1;
        throw new Error('Node localStorage getter must not be used.');
      },
    });

    setMenuDebugEnabled(true);

    expect(nodeAccessorReads).toBe(0);
    expect(isMenuDebugEnabled()).toBe(false);
    expect(nodeAccessorReads).toBe(0);
  });
});
