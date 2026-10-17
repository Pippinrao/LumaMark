import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';

export type DocumentImageReference = {
  alt: string;
  angleBracketed: boolean;
  destination: { from: number; to: number };
  lineNumber: number;
  source: string;
};

export type DocumentImageScan = {
  blobImageCount: number;
  dataImageCount: number;
  draftImageCount: number;
  htmlImageCount: number;
  images: DocumentImageReference[];
};

type SyntaxNode = {
  from: number;
  to: number;
  getChild: (name: string) => SyntaxNode | null;
};

type LinkDefinition = {
  angleBracketed: boolean;
  from: number;
  source: string;
  to: number;
};

export function scanDocumentImageReferences(
  state: EditorState,
): DocumentImageScan {
  const definitions = collectLinkDefinitions(state);
  const images: DocumentImageReference[] = [];
  const seenDestinations = new Set<string>();
  let htmlImageCount = 0;

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'HTMLTag' || node.name === 'HTMLBlock') {
        const raw = state.doc.sliceString(node.from, node.to);
        htmlImageCount += raw.match(/<img\b[^>]*\bsrc\s*=/giu)?.length ?? 0;
        return;
      }

      if (node.name !== 'Image') {
        return;
      }

      const syntax = node.node;
      const urlNode = syntax.getChild('URL');
      if (urlNode) {
        pushImage(state, images, seenDestinations, urlNode, syntax, null);
        return;
      }

      const labelNode = syntax.getChild('LinkLabel');
      const raw = state.doc.sliceString(node.from, node.to);
      const alt = altText(raw);
      const label = normalizeLabel(
        labelNode
          ? state.doc
              .sliceString(labelNode.from, labelNode.to)
              .slice(1, -1)
              .trim() || alt
          : alt,
      );
      const definition = definitions.get(label);
      if (!definition) {
        return;
      }

      pushImage(
        state,
        images,
        seenDestinations,
        {
          from: definition.from,
          to: definition.to,
        },
        syntax,
        definition,
        alt,
      );
    },
  });

  images.sort((left, right) => left.destination.from - right.destination.from);

  let blobImageCount = 0;
  let dataImageCount = 0;
  let draftImageCount = 0;
  for (const image of images) {
    if (/^blob:/iu.test(image.source)) {
      blobImageCount += 1;
    } else if (/^data:/iu.test(image.source)) {
      dataImageCount += 1;
    } else if (/^lumamark-draft:/iu.test(image.source)) {
      draftImageCount += 1;
    }
  }

  return {
    blobImageCount,
    dataImageCount,
    draftImageCount,
    htmlImageCount,
    images,
  };
}

function pushImage(
  state: EditorState,
  images: DocumentImageReference[],
  seenDestinations: Set<string>,
  destinationNode: { from: number; to: number },
  imageNode: SyntaxNode,
  definition: LinkDefinition | null,
  altFallback?: string,
): void {
  const key = `${destinationNode.from}:${destinationNode.to}`;
  if (seenDestinations.has(key)) {
    return;
  }

  const rawDestination = state.doc.sliceString(
    destinationNode.from,
    destinationNode.to,
  );
  const parsed =
    definition ??
    parseDestination(rawDestination);
  if (!parsed.source) {
    return;
  }

  seenDestinations.add(key);
  images.push({
    alt: altFallback ?? altText(state.doc.sliceString(imageNode.from, imageNode.to)),
    angleBracketed: parsed.angleBracketed,
    destination: { from: destinationNode.from, to: destinationNode.to },
    lineNumber: state.doc.lineAt(destinationNode.from).number - 1,
    source: parsed.source,
  });
}

function parseDestination(raw: string): {
  angleBracketed: boolean;
  source: string;
} {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return { angleBracketed: true, source: trimmed.slice(1, -1) };
  }
  return { angleBracketed: false, source: trimmed };
}

function collectLinkDefinitions(
  state: EditorState,
): Map<string, LinkDefinition> {
  const definitions = new Map<string, LinkDefinition>();

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'LinkReference') {
        return;
      }

      const labelNode = node.node.getChild('LinkLabel');
      const urlNode = node.node.getChild('URL');
      if (!labelNode || !urlNode) {
        return;
      }

      const label = normalizeLabel(
        state.doc.sliceString(labelNode.from, labelNode.to).slice(1, -1),
      );
      if (!label || definitions.has(label)) {
        return;
      }

      const parsed = parseDestination(
        state.doc.sliceString(urlNode.from, urlNode.to),
      );
      if (!parsed.source) {
        return;
      }

      definitions.set(label, {
        ...parsed,
        from: urlNode.from,
        to: urlNode.to,
      });
    },
  });

  return definitions;
}

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function altText(raw: string): string {
  const match = /^!\[(?<alt>[\s\S]*?)\]/u.exec(raw);
  return (match?.groups?.alt ?? '').replace(/\\([\\[\]])/gu, '$1');
}
