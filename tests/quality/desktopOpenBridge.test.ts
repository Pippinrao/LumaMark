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
        fileAssociations?: Array<{
          description?: string;
          ext: string[];
          name?: string;
          role?: string;
        }>;
      };
    };

    expect(config.bundle.fileAssociations).toEqual([
      expect.objectContaining({
        ext: ['md', 'markdown', 'mdown'],
        role: 'Editor',
      }),
    ]);

    const association = config.bundle.fileAssociations?.[0];
    // NSIS maps `name` onto the Windows ProgId / FILECLASS. Spaces and punctuation
    // other than `. _ -` produce fragile Software\Classes keys and can break
    // Explorer "Open with" / double-click registration on real installs.
    expect(association?.name).toMatch(/^[A-Za-z][A-Za-z0-9._-]*$/);
    expect(association?.name).toMatch(/^LumaMark\./);
  });

  it('keeps generated NSIS association macros on a stable ProgId when present', () => {
    const nsisPath = join(
      root,
      'src-tauri/target/release/nsis/x64/installer.nsi',
    );
    if (!existsSync(nsisPath)) {
      return;
    }

    const nsis = readFileSync(nsisPath, 'utf8');
    expect(nsis).toContain('!insertmacro APP_ASSOCIATE "md"');
    expect(nsis).not.toMatch(
      /!insertmacro APP_ASSOCIATE "[^"]+" "Markdown Document"/,
    );
    expect(nsis).toMatch(
      /!insertmacro APP_ASSOCIATE "md" "LumaMark\.[^"]+"/,
    );
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
