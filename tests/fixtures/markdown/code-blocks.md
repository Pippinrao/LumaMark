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

~~~shell
printf 'tilde fences stay intact\n'
~~~

````typescript linenos=true
const shorterFence = '```';
````

```MyDSL option=value
unknown languages keep their original info token
```

```
plain fenced code without an info string
```

```
```

Indented code block:

    preserve exactly four leading spaces
    and keep blank lines nearby

Unclosed fence at end of file:

~~~unknown-tail
the parser and round-trip must preserve this source
