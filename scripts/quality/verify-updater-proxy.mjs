import { execFile } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const EXPECTED_REQWEST_FEATURES = ['system-proxy'];
const EXPECTED_REQWEST_VERSION = '0.13.4';
const EXPECTED_REQWEST_REQUIREMENT = `=${EXPECTED_REQWEST_VERSION}`;
const WINDOWS_DEPENDENCY_TARGET = 'cfg(windows)';
const WINDOWS_TARGET = 'x86_64-pc-windows-msvc';

export function buildCargoMetadataArgs(manifestPath) {
  return [
    'metadata',
    '--locked',
    '--filter-platform',
    WINDOWS_TARGET,
    '--format-version',
    '1',
    '--manifest-path',
    manifestPath,
  ];
}

export function validateUpdaterProxyMetadata(metadata) {
  const packages = requireArray(metadata?.packages, 'packages');
  const nodes = requireArray(metadata?.resolve?.nodes, 'resolve.nodes');
  const rootId = metadata?.resolve?.root;

  if (typeof rootId !== 'string') {
    throw new Error('Cargo metadata does not identify a workspace root package.');
  }

  const packagesById = new Map(packages.map((pkg) => [pkg.id, pkg]));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const rootPackage = packagesById.get(rootId);
  const rootNode = nodesById.get(rootId);
  if (!rootPackage) {
    throw new Error(`Cargo metadata does not contain the root package ${rootId}.`);
  }
  if (!rootNode) {
    throw new Error(`Cargo metadata does not contain the root resolve node ${rootId}.`);
  }
  validateRootReqwestDeclaration(rootPackage);

  const updaterDependencies = dependenciesForPackageName(
    rootNode,
    packagesById,
    'tauri-plugin-updater',
  );
  if (updaterDependencies.length !== 1) {
    throw new Error(
      `Expected exactly one tauri-plugin-updater dependency from the workspace root, found ${updaterDependencies.length}.`,
    );
  }

  const updaterPackage = packagesById.get(updaterDependencies[0].pkg);
  const updaterNode = nodesById.get(updaterDependencies[0].pkg);
  if (!updaterPackage || !updaterNode) {
    throw new Error('Cargo metadata is missing the resolved tauri-plugin-updater package.');
  }

  const reqwestDependencies = dependenciesForPackageName(
    updaterNode,
    packagesById,
    'reqwest',
  );
  if (reqwestDependencies.length !== 1) {
    throw new Error(
      `Expected tauri-plugin-updater to resolve exactly one direct reqwest dependency, found ${reqwestDependencies.length}.`,
    );
  }

  const rootReqwestDependencies = dependenciesForPackageName(
    rootNode,
    packagesById,
    'reqwest',
  );
  if (rootReqwestDependencies.length !== 1) {
    throw new Error(
      `Expected exactly one direct reqwest dependency from the workspace root, found ${rootReqwestDependencies.length}.`,
    );
  }
  if (rootReqwestDependencies[0].pkg !== reqwestDependencies[0].pkg) {
    throw new Error(
      'Workspace root and tauri-plugin-updater must resolve the same reqwest package ID.',
    );
  }

  const reqwestPackage = packagesById.get(reqwestDependencies[0].pkg);
  const reqwestNode = nodesById.get(reqwestDependencies[0].pkg);
  if (!reqwestPackage || !reqwestNode) {
    throw new Error('Cargo metadata is missing the updater reqwest resolve node.');
  }
  if (reqwestPackage.version !== EXPECTED_REQWEST_VERSION) {
    throw new Error(
      `Windows updater proxy support requires reqwest ${EXPECTED_REQWEST_VERSION}, found ${reqwestPackage.version}.`,
    );
  }
  requireResolvedFeature(
    reqwestNode,
    `reqwest ${reqwestPackage.version}`,
    'system-proxy',
  );

  const hyperUtilDependencies = dependenciesForPackageName(
    reqwestNode,
    packagesById,
    'hyper-util',
  );
  if (hyperUtilDependencies.length !== 1) {
    throw new Error(
      `Expected reqwest ${reqwestPackage.version} to resolve exactly one direct hyper-util dependency, found ${hyperUtilDependencies.length}.`,
    );
  }

  const hyperUtilPackage = packagesById.get(hyperUtilDependencies[0].pkg);
  const hyperUtilNode = nodesById.get(hyperUtilDependencies[0].pkg);
  if (!hyperUtilPackage || !hyperUtilNode) {
    throw new Error('Cargo metadata is missing the reqwest hyper-util resolve node.');
  }
  requireResolvedFeature(
    hyperUtilNode,
    `hyper-util ${hyperUtilPackage.version}`,
    'client-proxy-system',
  );

  return {
    hyperUtilVersion: hyperUtilPackage.version,
    reqwestVersion: reqwestPackage.version,
    updaterVersion: updaterPackage.version,
  };
}

function validateRootReqwestDeclaration(rootPackage) {
  const dependencies = requireArray(
    rootPackage.dependencies,
    `${rootPackage.id}.dependencies`,
  ).filter((dependency) => dependency.name === 'reqwest');
  if (dependencies.length !== 1) {
    throw new Error(
      `Expected exactly one reqwest dependency declaration in the workspace root package metadata, found ${dependencies.length}.`,
    );
  }

  const dependency = dependencies[0];
  if (dependency.target !== WINDOWS_DEPENDENCY_TARGET) {
    throw new Error(
      `Workspace root reqwest dependency must target exactly "${WINDOWS_DEPENDENCY_TARGET}", found ${formatMetadataValue(dependency.target)}.`,
    );
  }
  if (dependency.req !== EXPECTED_REQWEST_REQUIREMENT) {
    throw new Error(
      `Workspace root reqwest dependency must require exactly "${EXPECTED_REQWEST_REQUIREMENT}", found ${formatMetadataValue(dependency.req)}.`,
    );
  }
  if (dependency.uses_default_features !== false) {
    throw new Error(
      `Workspace root reqwest dependency must set uses_default_features to false, found ${formatMetadataValue(dependency.uses_default_features)}.`,
    );
  }
  if (dependency.kind !== null) {
    throw new Error(
      `Workspace root reqwest dependency must be a normal runtime dependency with kind null, found ${formatMetadataValue(dependency.kind)}.`,
    );
  }

  const features = [
    ...requireArray(dependency.features, 'root reqwest dependency features'),
  ].sort();
  const expectedFeatures = [...EXPECTED_REQWEST_FEATURES].sort();
  if (JSON.stringify(features) !== JSON.stringify(expectedFeatures)) {
    throw new Error(
      `Workspace root reqwest dependency must declare exactly ${JSON.stringify(expectedFeatures)}, found ${JSON.stringify(features)}.`,
    );
  }
}

function formatMetadataValue(value) {
  return JSON.stringify(value) ?? String(value);
}

function dependenciesForPackageName(node, packagesById, packageName) {
  return requireArray(node.deps, `${node.id}.deps`).filter(
    (dependency) => packagesById.get(dependency.pkg)?.name === packageName,
  );
}

function requireResolvedFeature(node, packageLabel, feature) {
  const features = requireArray(node.features, `${node.id}.features`);
  if (!features.includes(feature)) {
    throw new Error(
      `${packageLabel} is missing required resolved feature "${feature}".`,
    );
  }
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new Error(`Cargo metadata field ${field} must be an array.`);
  }
  return value;
}

async function loadWindowsCargoMetadata(root) {
  const manifestPath = path.join(root, 'src-tauri', 'Cargo.toml');
  const { stderr, stdout } = await execFileAsync(
    'cargo',
    buildCargoMetadataArgs(manifestPath),
    {
      cwd: root,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );

  if (stderr) {
    process.stderr.write(stderr);
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cargo metadata returned invalid JSON: ${detail}`, {
      cause: error,
    });
  }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const metadata = await loadWindowsCargoMetadata(root);
  const result = validateUpdaterProxyMetadata(metadata);

  process.stdout.write(
    `[quality:updater-proxy] tauri-plugin-updater ${result.updaterVersion} resolves reqwest ${result.reqwestVersion} system-proxy and hyper-util ${result.hyperUtilVersion} client-proxy-system.\n`,
  );
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[quality:updater-proxy] ${detail}\n`);
    process.exitCode = 1;
  });
}
