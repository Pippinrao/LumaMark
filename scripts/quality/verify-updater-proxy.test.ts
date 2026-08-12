import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCargoMetadataArgs,
  validateUpdaterProxyMetadata,
} from './verify-updater-proxy.mjs';

describe('verify-updater-proxy', () => {
  it('loads the locked Windows x64 Cargo dependency graph', () => {
    expect(buildCargoMetadataArgs('src-tauri/Cargo.toml')).toEqual([
      'metadata',
      '--locked',
      '--filter-platform',
      'x86_64-pc-windows-msvc',
      '--format-version',
      '1',
      '--manifest-path',
      'src-tauri/Cargo.toml',
    ]);
  });

  it('accepts the updater reqwest feature union required for Windows system proxy support', () => {
    expect(validateUpdaterProxyMetadata(buildMetadata())).toEqual({
      hyperUtilVersion: '0.1.20',
      reqwestVersion: '0.13.4',
      updaterVersion: '2.10.1',
    });
  });

  it('fails closed when the workspace root no longer resolves one updater', () => {
    expect(() =>
      validateUpdaterProxyMetadata(buildMetadata({ includeUpdater: false })),
    ).toThrow(
      'Expected exactly one tauri-plugin-updater dependency from the workspace root, found 0.',
    );
  });

  it('fails closed when the updater resolves more than one reqwest dependency', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ updaterReqwestVersions: ['0.13.4', '0.13.5'] }),
      ),
    ).toThrow(
      'Expected tauri-plugin-updater to resolve exactly one direct reqwest dependency, found 2.',
    );
  });

  it('fails closed when the workspace root does not directly resolve reqwest', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ includeRootReqwest: false }),
      ),
    ).toThrow(
      'Expected exactly one direct reqwest dependency from the workspace root, found 0.',
    );
  });

  it('rejects a root reqwest package ID that differs from the updater reqwest', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootReqwestMatchesUpdater: false }),
      ),
    ).toThrow(
      'Workspace root and tauri-plugin-updater must resolve the same reqwest package ID.',
    );
  });

  it('fails closed when the root package declaration omits reqwest', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestCount: 0 }),
      ),
    ).toThrow(
      'Expected exactly one reqwest dependency declaration in the workspace root package metadata, found 0.',
    );
  });

  it('fails closed when the root package declares reqwest more than once', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestCount: 2 }),
      ),
    ).toThrow(
      'Expected exactly one reqwest dependency declaration in the workspace root package metadata, found 2.',
    );
  });

  it('rejects a root reqwest declaration outside the Windows target', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestTarget: null }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must target exactly "cfg(windows)", found null.',
    );
  });

  it('rejects a relaxed root reqwest version requirement', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestRequirement: '^0.13.4' }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must require exactly "=0.13.4", found "^0.13.4".',
    );
  });

  it('rejects default features on the root reqwest declaration', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestUsesDefaultFeatures: true }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must set uses_default_features to false, found true.',
    );
  });

  it('rejects a development-only root reqwest declaration', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestKind: 'development' }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must be a normal runtime dependency with kind null, found "development".',
    );
  });

  it('rejects a build-only root reqwest declaration', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestKind: 'build' }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must be a normal runtime dependency with kind null, found "build".',
    );
  });

  it('rejects extra features on the root reqwest declaration', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({
          rootManifestReqwestFeatures: ['system-proxy', 'json'],
        }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must declare exactly ["system-proxy"], found ["json","system-proxy"].',
    );
  });

  it('rejects a root reqwest declaration without system-proxy', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ rootManifestReqwestFeatures: [] }),
      ),
    ).toThrow(
      'Workspace root reqwest dependency must declare exactly ["system-proxy"], found [].',
    );
  });

  it('rejects a different reqwest version selected by the updater', () => {
    expect(() =>
      validateUpdaterProxyMetadata(
        buildMetadata({ updaterReqwestVersions: ['0.13.5'] }),
      ),
    ).toThrow(
      'Windows updater proxy support requires reqwest 0.13.4, found 0.13.5.',
    );
  });

  it('rejects reqwest without system-proxy in the resolved feature union', () => {
    expect(() =>
      validateUpdaterProxyMetadata(buildMetadata({ reqwestFeatures: [] })),
    ).toThrow(
      'reqwest 0.13.4 is missing required resolved feature "system-proxy".',
    );
  });

  it('rejects reqwest without a unique corresponding hyper-util dependency', () => {
    expect(() =>
      validateUpdaterProxyMetadata(buildMetadata({ includeHyperUtil: false })),
    ).toThrow(
      'Expected reqwest 0.13.4 to resolve exactly one direct hyper-util dependency, found 0.',
    );
  });

  it('rejects hyper-util without client-proxy-system in the resolved feature union', () => {
    expect(() =>
      validateUpdaterProxyMetadata(buildMetadata({ hyperUtilFeatures: [] })),
    ).toThrow(
      'hyper-util 0.1.20 is missing required resolved feature "client-proxy-system".',
    );
  });

  it('wires the fail-closed gate into package scripts and Windows CI', async () => {
    const root = process.cwd();
    const packageJson = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const workflow = await readFile(
      path.join(root, '.github', 'workflows', 'v1-quality.yml'),
      'utf8',
    );

    expect(packageJson.scripts['quality:updater-proxy']).toBe(
      'node scripts/quality/verify-updater-proxy.mjs',
    );
    expect(workflow).toContain('pnpm quality:updater-proxy');
    expect(workflow.indexOf('pnpm quality:updater-proxy')).toBeLessThan(
      workflow.indexOf('cargo check --manifest-path src-tauri/Cargo.toml'),
    );
  });
});

type MetadataOptions = {
  hyperUtilFeatures?: string[];
  includeHyperUtil?: boolean;
  includeRootReqwest?: boolean;
  includeUpdater?: boolean;
  reqwestFeatures?: string[];
  rootManifestReqwestCount?: number;
  rootManifestReqwestFeatures?: string[];
  rootManifestReqwestKind?: string | null;
  rootManifestReqwestRequirement?: string;
  rootManifestReqwestTarget?: string | null;
  rootManifestUsesDefaultFeatures?: boolean;
  rootReqwestMatchesUpdater?: boolean;
  updaterReqwestVersions?: string[];
};

function buildMetadata({
  hyperUtilFeatures = ['client', 'client-proxy-system'],
  includeHyperUtil = true,
  includeRootReqwest = true,
  includeUpdater = true,
  reqwestFeatures = ['json', 'system-proxy'],
  rootManifestReqwestCount = 1,
  rootManifestReqwestFeatures = ['system-proxy'],
  rootManifestReqwestKind = null,
  rootManifestReqwestRequirement = '=0.13.4',
  rootManifestReqwestTarget = 'cfg(windows)',
  rootManifestUsesDefaultFeatures = false,
  rootReqwestMatchesUpdater = true,
  updaterReqwestVersions = ['0.13.4'],
}: MetadataOptions = {}) {
  const rootId = 'path+file:///repo/src-tauri#lumamark@0.2.33';
  const updaterId =
    'registry+https://github.com/rust-lang/crates.io-index#tauri-plugin-updater@2.10.1';
  const hyperUtilId =
    'registry+https://github.com/rust-lang/crates.io-index#hyper-util@0.1.20';
  const reqwestPackages = updaterReqwestVersions.map((version, index) => ({
    id: `registry+https://example.invalid/${index}#reqwest@${version}`,
    name: 'reqwest',
    version,
  }));
  const rootReqwestPackage = rootReqwestMatchesUpdater
    ? reqwestPackages[0]
    : {
        id: 'registry+https://root.example.invalid#reqwest@0.13.4',
        name: 'reqwest',
        version: '0.13.4',
      };
  const rootManifestReqwestDependencies = Array.from(
    { length: rootManifestReqwestCount },
    () => ({
      features: rootManifestReqwestFeatures,
      kind: rootManifestReqwestKind,
      name: 'reqwest',
      req: rootManifestReqwestRequirement,
      target: rootManifestReqwestTarget,
      uses_default_features: rootManifestUsesDefaultFeatures,
    }),
  );
  const packages = [
    {
      dependencies: rootManifestReqwestDependencies,
      id: rootId,
      name: 'lumamark',
      version: '0.2.33',
    },
    { id: updaterId, name: 'tauri-plugin-updater', version: '2.10.1' },
    ...reqwestPackages,
    ...(!rootReqwestMatchesUpdater && rootReqwestPackage
      ? [rootReqwestPackage]
      : []),
    ...(includeHyperUtil
      ? [{ id: hyperUtilId, name: 'hyper-util', version: '0.1.20' }]
      : []),
  ];
  const nodes = [
    {
      deps: [
        ...(includeUpdater
          ? [{ name: 'tauri_plugin_updater', pkg: updaterId }]
          : []),
        ...(includeRootReqwest && rootReqwestPackage
          ? [{ name: 'reqwest', pkg: rootReqwestPackage.id }]
          : []),
      ],
      features: [],
      id: rootId,
    },
    {
      deps: reqwestPackages.map(({ id }) => ({ name: 'reqwest', pkg: id })),
      features: ['default'],
      id: updaterId,
    },
    ...reqwestPackages.map(({ id }) => ({
      deps: includeHyperUtil ? [{ name: 'hyper_util', pkg: hyperUtilId }] : [],
      features: reqwestFeatures,
      id,
    })),
    ...(!rootReqwestMatchesUpdater && rootReqwestPackage
      ? [
          {
            deps: includeHyperUtil
              ? [{ name: 'hyper_util', pkg: hyperUtilId }]
              : [],
            features: reqwestFeatures,
            id: rootReqwestPackage.id,
          },
        ]
      : []),
    ...(includeHyperUtil
      ? [{ deps: [], features: hyperUtilFeatures, id: hyperUtilId }]
      : []),
  ];

  return {
    packages,
    resolve: {
      nodes,
      root: rootId,
    },
  };
}
