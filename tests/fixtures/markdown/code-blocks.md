# Code Blocks Fixture

Inline code: `const value = "markdown";`.

```ts
type DocumentState = {
  readonly path: string;
  readonly source: string;
};

export function preserveSource(state: DocumentState): string {
  return state.source;
}
```

```json
{
  "name": "lumamark",
  "sourcePreservation": true,
  "languages": ["en", "zh-CN"]
}
```

```bash
pnpm test:fixtures
pnpm perf:bench
```

Indented code block:

    preserve exactly four leading spaces
    and keep blank lines nearby
