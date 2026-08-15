export type LinkUrlClassification =
  | {
      href: string;
      kind: 'absoluteAllowed';
    }
  | {
      href: string;
      kind: 'relative';
    }
  | {
      code:
        | 'link.empty'
        | 'link.protocol_data'
        | 'link.protocol_file'
        | 'link.protocol_javascript'
        | 'link.protocol_rejected';
      href: string;
      kind: 'rejected';
    };

const ABSOLUTE_ALLOWED = new Set(['http:', 'https:', 'mailto:']);

export function classifyLinkUrl(href: string): LinkUrlClassification {
  const trimmed = href.trim();
  if (!trimmed) {
    return {
      code: 'link.empty',
      href,
      kind: 'rejected',
    };
  }

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!schemeMatch) {
    return {
      href,
      kind: 'relative',
    };
  }

  const scheme = `${schemeMatch[1].toLowerCase()}:`;
  if (ABSOLUTE_ALLOWED.has(scheme)) {
    return {
      href,
      kind: 'absoluteAllowed',
    };
  }

  if (scheme === 'javascript:') {
    return {
      code: 'link.protocol_javascript',
      href,
      kind: 'rejected',
    };
  }

  if (scheme === 'data:') {
    return {
      code: 'link.protocol_data',
      href,
      kind: 'rejected',
    };
  }

  if (scheme === 'file:') {
    return {
      code: 'link.protocol_file',
      href,
      kind: 'rejected',
    };
  }

  return {
    code: 'link.protocol_rejected',
    href,
    kind: 'rejected',
  };
}
