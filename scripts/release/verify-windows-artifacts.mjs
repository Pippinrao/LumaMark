import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const artifactSpecs = [
  {
    dir: 'src-tauri/target/release',
    kind: 'exe',
    match: (name) => name === 'lumamark.exe',
  },
  {
    dir: 'src-tauri/target/release/bundle/msi',
    kind: 'msi',
    match: (name) => name.endsWith('.msi'),
  },
  {
    dir: 'src-tauri/target/release/bundle/nsis',
    kind: 'nsis',
    match: (name) => name.endsWith('setup.exe'),
  },
];

const root = parseRoot(process.argv.slice(2));

try {
  const artifacts = [];

  for (const spec of artifactSpecs) {
    const relativePath = await findSingleArtifact(spec);
    const fullPath = resolve(root, ...relativePath.split('/'));
    const file = await stat(fullPath);

    if (file.size <= 0) {
      throw new Error(`Artifact is empty: ${spec.kind} (${relativePath})`);
    }

    artifacts.push({
      kind: spec.kind,
      path: relativePath,
      sha256: await sha256(fullPath),
      sizeBytes: file.size,
    });
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        artifacts,
        generatedAt: new Date().toISOString(),
        root,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

function parseRoot(args) {
  const index = args.indexOf('--root');

  if (index === -1) {
    return process.cwd();
  }

  const value = args.at(index + 1);
  if (!value) {
    throw new Error('--root requires a path.');
  }

  return resolve(value);
}

async function findSingleArtifact(spec) {
  const dir = resolve(root, ...spec.dir.split('/'));
  let names;

  try {
    names = await readdir(dir);
  } catch {
    throw new Error(`Missing required artifact: ${spec.kind} (${spec.dir})`);
  }

  const matches = names.filter(spec.match).sort();

  if (matches.length === 0) {
    throw new Error(`Missing required artifact: ${spec.kind} (${spec.dir})`);
  }

  if (matches.length > 1) {
    throw new Error(
      `Expected exactly one ${spec.kind} artifact, found ${matches.length}.`,
    );
  }

  return `${spec.dir}/${matches[0]}`;
}

function sha256(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      resolveHash(hash.digest('hex'));
    });
  });
}
