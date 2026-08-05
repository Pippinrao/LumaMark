export const sidebarPanelConstraints = {
  defaultSize: '26%',
  maxSize: '360px',
  minSize: '240px',
} as const;

const SIDEBAR_FILENAME_CHROME_WIDTH = 96;
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 360;

export function sidebarWidthForMeasuredFileName(measuredWidth: number): number {
  return Math.min(
    SIDEBAR_MAX_WIDTH,
    Math.max(SIDEBAR_MIN_WIDTH, measuredWidth + SIDEBAR_FILENAME_CHROME_WIDTH),
  );
}
