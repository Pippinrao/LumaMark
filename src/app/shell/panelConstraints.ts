export const sidebarPanelConstraints = {
  defaultSize: '26%',
  minSize: '120px',
} as const;

export const SIDEBAR_ADAPTIVE_MIN_WIDTH = 200;
export const SIDEBAR_ADAPTIVE_MAX_WIDTH = 480;

// Chevron, file icon, row gaps and the section padding that sit around the
// measured label text.
const SIDEBAR_CONTENT_CHROME_WIDTH = 72;

export function sidebarWidthForContentWidth(contentWidth: number): number {
  if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
    return SIDEBAR_ADAPTIVE_MIN_WIDTH;
  }

  return Math.min(
    SIDEBAR_ADAPTIVE_MAX_WIDTH,
    Math.max(
      SIDEBAR_ADAPTIVE_MIN_WIDTH,
      Math.round(contentWidth + SIDEBAR_CONTENT_CHROME_WIDTH),
    ),
  );
}
