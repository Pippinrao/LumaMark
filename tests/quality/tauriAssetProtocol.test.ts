import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Tauri asset protocol contract', () => {
  it('does not grant asset protocol access to the whole file system', async () => {
    const config = JSON.parse(
      await readFile(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as {
      app?: {
        security?: {
          assetProtocol?: {
            enable?: boolean;
            scope?: string[];
          };
        };
      };
    };

    expect(config.app?.security?.assetProtocol?.enable).toBe(true);
    expect(config.app?.security?.assetProtocol?.scope).not.toContain('**/*');
    expect(config.app?.security?.assetProtocol?.scope).toEqual([]);
  });

  it('allows Tauri asset image URLs on Windows without widening file scope', async () => {
    const config = JSON.parse(
      await readFile(join(process.cwd(), 'src-tauri', 'tauri.conf.json'), 'utf8'),
    ) as {
      app?: {
        security?: {
          csp?: string;
        };
      };
    };

    expect(config.app?.security?.csp).toContain(
      "img-src 'self' data: blob: asset: http://asset.localhost",
    );
  });

  it('does not recursively grant the current document directory', async () => {
    const commandSource = await readFile(
      join(process.cwd(), 'src-tauri', 'src', 'commands', 'files.rs'),
      'utf8',
    );

    expect(commandSource).not.toContain('allow_directory');
    expect(commandSource).not.toContain('asset_protocol_scope');
  });

  it('moves remote image caching off the Tauri command thread', async () => {
    const commandSource = await readFile(
      join(process.cwd(), 'src-tauri', 'src', 'commands', 'assets.rs'),
      'utf8',
    );

    expect(commandSource).toContain('pub async fn assets_cache_remote_image');
    expect(commandSource).toContain('spawn_blocking');
  });
});
