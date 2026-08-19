export const sidebarPanelConstraints = {
  defaultSize: '26%',
  minSize: '120px',
} as const;

export const SIDEBAR_ADAPTIVE_MIN_WIDTH = 200;
export const SIDEBAR_ADAPTIVE_MAX_WIDTH = 480;

// Chevron, file icon, row gaps and the section padding that sit around the
// measured label text.
export const FILE_TREE_CONTENT_CHROME_WIDTH = 72;

// Outline rows have no chevron or file icon. Keep tab-panel padding, the
// item’s base padding, and list chrome only.
export const OUTLINE_CONTENT_CHROME_WIDTH = 40;

export function sidebarWidthForContentWidth(
  contentWidth: number,
  chromeWidth = FILE_TREE_CONTENT_CHROME_WIDTH,
): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
    return SIDEBAR_ADAPTIVE_MIN_WIDTH;
  }

  return Math.min(
    SIDEBAR_ADAPTIVE_MAX_WIDTH,
    Math.max(
      SIDEBAR_ADAPTIVE_MIN_WIDTH,
      Math.round(contentWidth + chromeWidth),
    ),
  );
}
