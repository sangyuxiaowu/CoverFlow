
export type LayerType = 'svg' | 'text' | 'image' | 'group' | 'decoration';

export interface DecorationElement {
  id: string;
  name: string;
  nameZh?: string;
  cssText: string;
  width: number;
  height: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface TextGradient {
  enabled: boolean;
  from: string;
  to: string;
  angle: number;
}

export interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}
// 模块：类型定义
export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  content: string; // SVG 代码、文字内容、图片 URL 或装饰 CSS
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
  textShadow?: TextShadow;
  children?: string[]; // 当类型为 group 时的子图层 ID
  parentId?: string; // 所属分组的图层 ID
}

export interface DecorationTemplate {
  id: string;
  name: string;
  nameZh?: string;
  width: number;
  height: number;
  layers: Layer[];
  createdAt?: number;
  updatedAt?: number;
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
