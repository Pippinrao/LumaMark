import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PlantUML preview canvas', () => {
  it('does not force a light paper behind dark-mode diagrams', () => {
    const css = readFileSync(
      join(process.cwd(), 'src/editor/capabilities/plantuml/plantuml.css'),
      'utf8',
    );
    const svgRule = css.match(/\.cm-content \.lm-plantuml-svg \{[^}]+\}/)?.[0];

    expect(svgRule).toBeDefined();
    expect(svgRule).not.toMatch(/#fff|#ffffff|white/i);
  });
});
