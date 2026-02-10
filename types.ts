
export type LayerType = 'svg' | 'text' | 'image' | 'group';

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  content: string; // SVG code, Text content, or Image URL
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  color?: string;
  fontSize?: number;
  ratioLocked?: boolean;
  children?: string[]; // Layer IDs if type is 'group'
}

export interface CanvasConfig {
  width: number;
  height: number;
  ratio: string;
}

export interface BackgroundConfig {
  type: 'color' | 'gradient' | 'image';
  value: string; // Hex, CSS gradient, or URL
  overlayType: 'none' | 'dots' | 'grid' | 'stripes';
  overlayColor: string;
  overlayOpacity: number;
  overlayScale: number;
}

export interface ProjectState {
  id: string;
  title: string;
  layers: Layer[];
  background: BackgroundConfig;
  canvasConfig: CanvasConfig;
  selectedLayerId: string | null;
  updatedAt: number;
}

export interface PresetRatio {
  name: string;
  nameZh?: string;
  ratio: string;
  width: number;
  height: number;
}
