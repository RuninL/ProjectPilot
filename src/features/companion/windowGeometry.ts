export interface CompanionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
const MIN_WIDTH = 320;
const MIN_HEIGHT = 420;
const DEFAULT: CompanionGeometry = { x: 40, y: 40, width: 380, height: 520 };

/** Restores a previously saved window only when it still intersects a visible display. */
export function safeCompanionGeometry(
  saved: CompanionGeometry | null,
  area: WorkArea,
): CompanionGeometry {
  if (saved === null) return { ...DEFAULT };
  const width = Math.max(MIN_WIDTH, Math.min(saved.width, area.width));
  const height = Math.max(MIN_HEIGHT, Math.min(saved.height, area.height));
  const right = saved.x + width;
  const bottom = saved.y + height;
  if (
    right <= area.x ||
    bottom <= area.y ||
    saved.x >= area.x + area.width ||
    saved.y >= area.y + area.height
  ) {
    return { ...DEFAULT, x: area.x + 40, y: area.y + 40 };
  }
  return {
    x: Math.max(area.x, Math.min(saved.x, area.x + area.width - width)),
    y: Math.max(area.y, Math.min(saved.y, area.y + area.height - height)),
    width,
    height,
  };
}
