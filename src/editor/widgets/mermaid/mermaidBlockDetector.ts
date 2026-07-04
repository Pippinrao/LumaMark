import { iterateLines } from '../../wysiwyg/decorationTypes';

export type MermaidBlock = {
  content: string;
  contentFrom: number;
  contentTo: number;
  fence: string;
  from: number;
  info: string;
  language: 'mermaid';
  to: number;
};

type ActiveFence = {
  char: '`' | '~';
  contentFrom: number;
  fence: string;
  from: number;
  info: string;
  length: number;
};

const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

export function detectMermaidBlocks(markdown: string): MermaidBlock[] {
  const blocks: MermaidBlock[] = [];
  let activeFence: ActiveFence | null = null;

  for (const line of iterateLines(markdown)) {
    const fence = parseFence(line.text);

    if (!fence) {
      continue;
    }

    if (activeFence) {
      if (
        fence.char === activeFence.char &&
        fence.length >= activeFence.length
      ) {
        blocks.push({
          content: markdown.slice(activeFence.contentFrom, line.from - 1),
          contentFrom: activeFence.contentFrom,
          contentTo: Math.max(activeFence.contentFrom, line.from - 1),
          fence: activeFence.fence,
          from: activeFence.from,
          info: activeFence.info,
          language: 'mermaid',
          to: line.to,
        });
        activeFence = null;
      }
      continue;
    }

    if (!isMermaidInfo(fence.info)) {
      continue;
    }

    activeFence = {
      ...fence,
      contentFrom: Math.min(line.to + 1, markdown.length),
      from: line.from,
    };
  }

  return blocks;
}

function parseFence(
  text: string,
): Pick<ActiveFence, 'char' | 'fence' | 'info' | 'length'> | null {
  const match = text.match(FENCE_PATTERN);

  if (!match) {
    return null;
  }

  return {
    char: match[1][0] as '`' | '~',
    fence: match[1][0].repeat(match[1].length),
    info: match[2].trim(),
    length: match[1].length,
  };
}

function isMermaidInfo(info: string): boolean {
  return /^mermaid(?:\s|$)/i.test(info);
}
