const fixtures = [
  {
    name: 'Wikimedia 1x1 PNG',
    source: 'https://commons.wikimedia.org/wiki/File:1x1.png',
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png',
    mime: 'image/png',
    minimumBytes: 68,
    kind: 'png',
  },
  {
    name: 'Wikimedia logo SVG',
    source: 'https://commons.wikimedia.org/wiki/File:Wikimedia-logo.svg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/81/Wikimedia-logo.svg',
    mime: 'image/svg+xml',
    minimumBytes: 300,
    kind: 'svg',
  },
];

const REQUEST_TIMEOUT_MS = 20_000;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function hasPngSignature(bytes) {
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function looksLikeSvg(bytes) {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 1024));
  return /<svg(?:\s|>)/i.test(prefix);
}

for (const fixture of fixtures) {
  const response = await fetch(fixture.url, {
    headers: {
      accept: fixture.mime,
      'user-agent': 'LumaMark-live-assets-test/0.1 (public fixture verification)',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const contentType = response.headers.get('content-type')?.split(';')[0];
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hasExpectedContent =
    fixture.kind === 'png' ? hasPngSignature(bytes) : looksLikeSvg(bytes);

  if (
    !response.ok ||
    contentType !== fixture.mime ||
    bytes.length < fixture.minimumBytes ||
    !hasExpectedContent
  ) {
    throw new Error(`${fixture.name} failed: status=${response.status}, type=${contentType}, bytes=${bytes.length}, source=${fixture.source}`);
  }

  console.log(`${fixture.name}: ${contentType}, ${bytes.length} bytes`);
}
