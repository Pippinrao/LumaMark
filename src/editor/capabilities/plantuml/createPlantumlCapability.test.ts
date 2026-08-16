import { describe, expect, it } from 'vitest';
import type { EditorDocumentContext } from '../../core/editorDisplayMode';
import { createLivePreviewCapabilities } from '..';
import { createPlantumlCapability } from './createPlantumlCapability';

const context: EditorDocumentContext = {
  documentId: 'document:test',
  path: null,
};

describe('createPlantumlCapability', () => {
  it('creates a live-preview PlantUML capability', () => {
    const capability = createPlantumlCapability(context);

    expect(capability.id).toBe('plantuml');
    expect(capability.extensions.length).toBeGreaterThan(0);
  });

  it('stays in the production capability sequence unless settings disable it', () => {
    expect(
      createLivePreviewCapabilities(context, false).map(({ id }) => id),
    ).toContain('plantuml');
    expect(
      createLivePreviewCapabilities(
        { ...context, plantuml: { enabled: false } },
        false,
      ).map(({ id }) => id),
    ).not.toContain('plantuml');
  });
});
