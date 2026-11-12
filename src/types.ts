export type Priority = 'high' | 'medium' | 'low';

export interface Finding {
  number: number | string;
  title: string;
  priority: Priority;
  lon: number;
  lat: number;
}

export interface Config {
  company: string;
  site: { name: string; address?: string; surveyDate?: string; client?: string };
  /** Path to the root tileset, relative to the page. */
  model: string;
  /** Metres to move the model up/down at display time so its street level meets the base map (e.g. -59). */
  heightOffset?: number;
  /** Building outline as a [lon, lat] ring, used by "Building only". */
  outline?: [number, number][];
  /** Metres to push the outline outwards so eaves and gutters are not cut. */
  outlinePadding?: number;
  /** Optional: in "Building only", also hide everything below this height (metres, after heightOffset). */
  buildingFloor?: number;
  findings?: Finding[];
}

export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  high: { label: 'High', color: '#e5484d' },
  medium: { label: 'Medium', color: '#f2a20c' },
  low: { label: 'Low', color: '#2f9e66' },
};
