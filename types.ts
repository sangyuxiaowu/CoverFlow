
export type LayerType = 'svg' | 'text' | 'image' | 'group';

export interface TextGradient {
  enabled: boolean;
  from: string;
  to: string;
  angle: number;
}
// 模块：类型定义
export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  content: string; // SVG 代码、文字内容或图片 URL
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
  fontFamily?: string;
  fontWeight?: string | number;
  textAlign?: 'left' | 'center' | 'right';
  writingMode?: 'horizontal' | 'vertical';
  ratioLocked?: boolean;
  textGradient?: TextGradient;
  children?: string[]; // 当类型为 group 时的子图层 ID
  parentId?: string; // 所属分组的图层 ID
}

export interface CanvasConfig {
  width: number;
  height: number;
  ratio: string;
}

export interface BackgroundConfig {
  type: 'color' | 'gradient' | 'image';
  value: string; // 颜色值、CSS 渐变或 URL
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

export interface FAIconMetadata {
  label: string;
  search: { terms: string[] };
  styles: string[];
  svgs: {
    [family: string]: {
      [style: string]: {
        raw: string;
        viewBox: number[];
        path: string;
        width?: number;
        height?: number;
      };
    };
  };
}

export interface FACategory {
  label: string;
  icons: string[];
}
