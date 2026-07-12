export const tinySvgDataUrl =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90"><rect width="160" height="90" rx="8" fill="#f2f7f4"/><circle cx="52" cy="45" r="24" fill="#247c5a"/><path d="M86 33h46v8H86zm0 16h36v8H86z" fill="#26352f"/></svg>',
  );

export const livePreviewRichMarkdown = [
  '# Live Preview Matrix',
  '',
  `![Inline SVG fixture](${tinySvgDataUrl})`,
  '',
  '```ts',
  'const value: number = 1',
  'console.log(value)',
  '```',
  '',
  '| Inline    | Link                        | Code   | Strike   |',
  '| --------- | --------------------------- | ------ | -------- |',
  '| **bold**  | [site](https://example.com) | `code` | ~~gone~~ |',
  '',
  'after',
].join('\n');
