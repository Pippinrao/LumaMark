import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AutomationService } from '../service.ts';
import { extractDiagrams } from '../markdown.ts';
import { MAX_DIAGRAMS, MAX_SOURCE_BYTES } from '../types.ts';

test('empty diagram fences fail validation instead of disappearing', async () => {
  const service = new AutomationService();
  try {
    for (const format of ['mermaid', 'plantuml']) {
      const report = await service.check('```' + format + '\n```', 'markdown');
      assert.equal(report.checked, 1);
      assert.equal(report.ok, false);
    }
  } finally { await service.close(); }
});

test('a legitimate PlantUML title containing Syntax Error? is not an engine error page', async () => {
  const service = new AutomationService();
  try {
    const report = await service.render('@startuml\ntitle Syntax Error?\nAlice -> Bob: hello\n@enduml', 'plantuml');
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.match(report.svg ?? '', /Syntax Error/);
  } finally { await service.close(); }
});

test('size and block limits reject work before starting a browser', async () => {
  const service = new AutomationService();
  try {
    await assert.rejects(service.check('中'.repeat(MAX_SOURCE_BYTES / 2), 'markdown'), { code: 'input.too_large' });
    assert.throws(() => extractDiagrams('```mermaid\ngraph TD\n```\n'.repeat(MAX_DIAGRAMS + 1)), { code: 'input.too_many_diagrams' });
    const empty = await service.check('# no diagrams', 'markdown');
    assert.equal(empty.checked, 0);
    assert.equal(empty.ok, true);
  } finally { await service.close(); }
});

test('Mermaid source within the input budget renders content rather than a max-text error SVG', async () => {
  const service = new AutomationService();
  try {
    const report = await service.render('flowchart TD\nA[OutputMarker] --> B\n' + '%% comment\n'.repeat(6000), 'mermaid');
    assert.equal(report.ok, true);
    assert.match(report.svg ?? '', /OutputMarker/);
  } finally { await service.close(); }
});
