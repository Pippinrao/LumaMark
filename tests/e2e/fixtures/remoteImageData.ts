export const remoteImageDocumentPath = 'E:/lumamark-fixtures/remote-images.md';

export const remoteImageFixtures = {
  png: {
    alt: 'Wikimedia PNG',
    cachePath: 'E:/lumamark-fixtures/.lumamark/assets/remote-cache/fixture.png',
    url: 'https://upload.wikimedia.org/wikipedia/commons/c/ca/1x1.png',
  },
  svg: {
    alt: 'Wikimedia SVG',
    cachePath: 'E:/lumamark-fixtures/.lumamark/assets/remote-cache/fixture.svg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/8/81/Wikimedia-logo.svg',
  },
  jpeg: {
    alt: 'JPEG fixture',
    cachePath: 'E:/lumamark-fixtures/.lumamark/assets/remote-cache/fixture.jpg',
    url: 'https://images.example.test/photo.jpg',
  },
  gif: {
    alt: 'GIF fixture',
    cachePath: 'E:/lumamark-fixtures/.lumamark/assets/remote-cache/fixture.gif',
    url: 'https://images.example.test/animation.gif',
  },
  webpWithQuery: {
    alt: '中文替代文字',
    cachePath: 'E:/lumamark-fixtures/.lumamark/assets/remote-cache/fixture.webp',
    url: 'https://images.example.test/photo.webp?width=640&label=%E4%B8%AD%E6%96%87#preview',
  },
} as const;

export const tinyDecodedImage =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="2" height="2"%3E%3Crect width="2" height="2" fill="%2300aaff"/%3E%3C/svg%3E';

export const invalidDecodedImage = 'data:image/png;base64,bm90LWFuLWltYWdl';

export function remoteMarkdown(
  fixtures: readonly { alt: string; url: string }[],
): string {
  return fixtures.map(({ alt, url }) => `![${alt}](${url})`).join('\n\n');
}
