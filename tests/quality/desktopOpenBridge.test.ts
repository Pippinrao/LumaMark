import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('desktop file-open bridge contract', () => {
  it('registers the supported Markdown file associations', () => {
    const config = JSON.parse(read('src-tauri/tauri.conf.json')) as {
      bundle: {
        fileAssociations?: Array<{ ext: string[]; role?: string }>;
      };
    };

    expect(config.bundle.fileAssociations).toEqual([
      expect.objectContaining({
        ext: ['md', 'markdown', 'mdown'],
        role: 'Editor',
      }),
    ]);
  });

  it('keeps first-instance OS paths lossless and registers single-instance before other plugins', () => {
    const source = read('src-tauri/src/lib.rs');
    const singleInstanceIndex = source.indexOf(
      '.plugin(tauri_plugin_single_instance::init',
    );
    const dialogIndex = source.indexOf('.plugin(tauri_plugin_dialog::init');

    expect(singleInstanceIndex).toBeGreaterThan(0);
    expect(singleInstanceIndex).toBeLessThan(dialogIndex);
    expect(source).toContain('std::env::args_os()');
    expect(source).not.toContain('std::env::args()');
    expect(source).toContain('.enqueue_os_args(&args, &cwd)');
    expect(source).toContain('.enqueue_utf8_args(&args');
    expect(source).toContain('window.unminimize()');
    expect(source).toContain('window.show()');
    expect(source).toContain('window.set_focus()');
    expect(source).toContain('open_requests_drain');
    expect(read('src-tauri/src/services/open_request_service.rs')).not.toContain(
      'to_string_lossy',
    );
  });

  it('documents the platform and rollback contract in the architecture map', () => {
    const adrPath = 'docs/decisions/0009-desktop-file-open-bridge.md';

    expect(existsSync(join(root, adrPath))).toBe(true);
    expect(read('docs/README.md')).toContain(adrPath.replace('docs/', ''));
    expect(read('docs/architecture/DETAILED_ARCHITECTURE.md')).toContain(
      'desktop-open-requests-available',
    );
  });
});
