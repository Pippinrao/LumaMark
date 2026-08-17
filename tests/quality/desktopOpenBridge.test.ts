import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function productionRun(source: string): string {
  const start = source.indexOf('pub fn run() {');
  const end = source.indexOf('\n#[cfg(test)]', start);
  if (start < 0 || end < 0) {
    throw new Error('The production Tauri run function is unavailable.');
  }
  return source.slice(start, end);
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
    const run = productionRun(source);
    const service = read(
      'src-tauri/src/services/desktop_window_service.rs',
    );
    const singleInstanceIndex = source.indexOf(
      '.plugin(tauri_plugin_single_instance::init',
    );
    const stateBootstrapIndex = source.indexOf(
      '.plugin(open_request_state_plugin(',
    );
    const dialogIndex = source.indexOf('.plugin(tauri_plugin_dialog::init');

    expect(singleInstanceIndex).toBeGreaterThan(0);
    expect(singleInstanceIndex).toBeLessThan(stateBootstrapIndex);
    expect(stateBootstrapIndex).toBeLessThan(dialogIndex);
    expect(run).toContain('std::env::args_os()');
    expect(run).not.toContain('std::env::args()');
    expect(run).toContain('router.recover_and_route_os_args(');
    expect(run).not.toContain('router.route_os_args(');
    expect(service).toContain('.enqueue_path_for_identity(');
    expect(service).toContain('window.unminimize()');
    expect(service).toContain('window.show()');
    expect(service).toContain('window.set_focus()');
    const invokeHandler = source
      .split('.invoke_handler(tauri::generate_handler![')[1]
      ?.split('])')[0];
    expect(invokeHandler).toBeDefined();
    expect(invokeHandler).not.toContain('open_requests_drain,');
    expect(invokeHandler).toContain('open_requests_record_applied,');
    expect(invokeHandler).toContain('open_requests_acknowledge,');
    expect(read('src-tauri/src/services/open_request_service.rs')).not.toContain(
      'to_string_lossy',
    );
  });

  it('routes secondary activations off the synchronous plugin callback and recovers durable targets', () => {
    const source = read('src-tauri/src/lib.rs');
    const run = productionRun(source);
    const service = read(
      'src-tauri/src/services/desktop_window_service.rs',
    );

    const callback = source
      .split(
        '.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {',
      )[1]
      ?.split('\n        }))')[0];
    expect(callback).toBeDefined();
    const workerBoundary = callback?.indexOf(
      'tauri::async_runtime::spawn_blocking',
    );
    expect(workerBoundary).toBeGreaterThan(0);
    const synchronousPrefix = callback?.slice(0, workerBoundary);
    expect(synchronousPrefix).toContain('let app_handle = app.clone()');
    expect(synchronousPrefix).toContain('let cwd = std::path::PathBuf::from(cwd)');
    expect(synchronousPrefix).toContain(
      'let route_config_dir = secondary_route_config_dir.clone()',
    );
    expect(synchronousPrefix).not.toContain('load_open_window_mode');
    expect(synchronousPrefix).not.toContain('parse_open_request');
    expect(synchronousPrefix).not.toContain('enqueue_utf8_args');
    expect(synchronousPrefix).not.toContain('WebviewWindowBuilder');
    expect(callback).toContain('route_utf8_args');
    expect(callback).toContain('wait_until_ready');
    expect(callback).toContain('match route_config_dir');
    expect(callback?.indexOf('wait_until_ready')).toBeLessThan(
      callback?.indexOf('match route_config_dir') ?? -1,
    );
    expect(source).toContain('desktop.open_request_state_startup_timeout');
    const statePlugin = source
      .split('fn open_request_state_plugin')[1]
      ?.split('\n}\n')[0];
    const userSetup = run.split('.setup(move |app| {')[1];
    expect(statePlugin).toBeDefined();
    expect(statePlugin).not.toContain('.mark_ready()');
    expect(userSetup).toBeDefined();
    expect(userSetup).toContain('.mark_ready()');
    expect(userSetup?.indexOf('router.recover_and_route_os_args(')).toBeLessThan(
      userSetup?.indexOf('.mark_ready()') ?? -1,
    );
    expect(run).toContain('router.recover_and_route_os_args(');
    expect(run).not.toContain('router.recover_active_targets_for_app(');
    expect(run).not.toContain('router.route_os_args(');
    expect(service).toContain('load_open_window_mode');
    expect(service).toContain('WebviewWindowBuilder::from_config');
    expect(service).toContain('active_target_windows');
    expect(service).toContain('DocumentPathIdentity::resolve(&request.path)');
    expect(service).toContain('owner_for_identity(self.identity()?)');
    expect(service).toContain(
      'target_window_for_active_identity(self.identity()?)',
    );
    expect(service).toContain(
      '.enqueue_path_for_identity(target_window, requested_path, self.identity()?)',
    );
  });

  it('keeps routing acceptance isolated without changing menu acceptance behavior', () => {
    const source = read('src-tauri/src/lib.rs');

    expect(source).toContain(
      'LUMAMARK_ROUTING_ACCEPTANCE_MODE',
    );
    expect(source).toContain('fn should_register_single_instance(');
    expect(source).toContain('desktop.routing_acceptance_mode_invalid');
    expect(source).toContain('desktop.routing_acceptance_config_required');
    expect(source).toContain('let register_single_instance = match');
    expect(source).toContain('if register_single_instance {');
    expect(source).toContain('.manage(OpenRequestStateReadiness::default())');
  });

  it('grants the main capability set only to main and managed document windows', () => {
    const capability = JSON.parse(
      read('src-tauri/capabilities/default.json'),
    ) as {
      $schema?: string;
      description: string;
      windows: string[];
    };

    expect(capability.windows).toEqual(['main', 'document-*']);
    expect(capability.description).toContain('document');
    expect(capability.$schema).toBe('../gen/schemas/desktop-schema.json');
  });

  it('documents the platform and rollback contract in the architecture map', () => {
    const adrPath = 'docs/decisions/0009-desktop-file-open-bridge.md';

    expect(existsSync(join(root, adrPath))).toBe(true);
    expect(read('docs/README.md')).toContain(adrPath.replace('docs/', ''));
    expect(read('docs/architecture/DETAILED_ARCHITECTURE.md')).toContain(
      'desktop-open-requests-available',
    );
    const adr = read(adrPath);
    expect(adr).toContain('multiWindow');
    expect(adr).toContain('aggregateWindow');
    expect(adr).toContain('spawn_blocking');
    expect(adr).toContain('document-*');
    expect(adr).toContain('LUMAMARK_ROUTING_ACCEPTANCE_MODE');
  });
});
