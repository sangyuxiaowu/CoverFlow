
import { PresetRatio } from './types.ts';

export const PRESET_RATIOS: (PresetRatio & { nameZh?: string })[] = [
  { name: 'WeChat 2.35:1', nameZh: '微信封面 2.35:1', ratio: '2.35:1', width: 900, height: 383 },
  { name: 'Square 1:1', nameZh: '正方形 1:1', ratio: '1:1', width: 900, height: 900 },
  { name: 'HD 16:9', nameZh: '高清视频 16:9', ratio: '16:9', width: 1280, height: 720 },
  { name: 'Classic 4:3', nameZh: '经典比例 4:3', ratio: '4:3', width: 1024, height: 768 },
  { name: 'Vertical 9:16', nameZh: '手机竖屏 9:16', ratio: '9:16', width: 720, height: 1280 },
];

export const CATEGORIZED_ASSETS = [
  {
    category: 'Basic Shapes',
    categoryZh: '基础形状',
    items: [
      { name: 'Circle', content: '<circle cx="50" cy="50" r="40" fill="currentColor" />' },
      { name: 'Rect', content: '<rect x="10" y="10" width="80" height="80" fill="currentColor" />' },
      { name: 'Triangle', content: '<path d="M50 10 L90 90 L10 90 Z" fill="currentColor" />' },
      { name: 'Star', content: '<path d="M50 5 L63 40 L100 40 L70 65 L82 100 L50 80 L18 100 L30 65 L0 40 L37 40 Z" fill="currentColor" />' },
    ]
  },
  {
    category: 'Decorations',
    categoryZh: '装饰元素',
    items: [
      { name: 'Wave', content: '<path d="M0 50 Q 25 25 50 50 T 100 50 L 100 100 L 0 100 Z" fill="currentColor" />' },
      { name: 'Blob', content: '<path d="M45,-60.1C58.7,-53.4,70.6,-40.8,76.5,-26.1C82.4,-11.3,82.3,5.6,76,20.1C69.7,34.5,57.1,46.5,43.4,55.8C29.6,65,14.8,71.4,-0.6,72.2C-15.9,73,-31.9,68.2,-45.3,58.8C-58.8,49.5,-69.7,35.6,-75.8,19.9C-81.8,4.2,-83.1,-13.4,-77,-28.9C-70.9,-44.4,-57.4,-57.9,-42.2,-64C-26.9,-70.2,-10.1,-69,4.4,-75.1C18.8,-81.1,31.4,-66.8,45,-60.1Z" transform="translate(100 100)" fill="currentColor" />' },
      { name: 'Sun', content: '<circle cx="50" cy="50" r="20" fill="currentColor" /><path d="M50 10 V25 M50 75 V90 M10 50 H25 M75 50 H90 M22 22 L32 32 M68 68 L78 78 M22 78 L32 68 M68 22 L78 32" stroke="currentColor" stroke-width="5" />' }
    ]
  }
];

export const PATTERNS = [
  { name: 'None', nameZh: '无', value: 'none' },
  { name: 'Dots', nameZh: '波点', value: 'radial-gradient(#ffffff22 2px, transparent 2px)' },
  { name: 'Grid', nameZh: '网格', value: 'linear-gradient(#ffffff11 1px, transparent 1px), linear-gradient(90deg, #ffffff11 1px, transparent 1px)' },
  { name: 'Stripes', nameZh: '条纹', value: 'repeating-linear-gradient(45deg, #ffffff05, #ffffff05 10px, #ffffff11 10px, #ffffff11 20px)' }
];

export const TEXT_GRADIENT_PRESETS = [
  { from: '#3b82f6', to: '#8b5cf6', angle: 90 },
  { from: '#f59e0b', to: '#ef4444', angle: 90 },
  { from: '#10b981', to: '#3b82f6', angle: 90 },
  { from: '#ff9a9e', to: '#fecfef', angle: 45 },
  { from: '#a1c4fd', to: '#c2e9fb', angle: 135 },
  { from: '#f6d365', to: '#fda085', angle: 120 },
  { from: '#667eea', to: '#764ba2', angle: 180 },
  { from: '#00c6fb', to: '#005bea', angle: 90 },
  { from: '#ff00ff', to: '#00ffff', angle: 135 },
  { from: '#fceabb', to: '#f8b500', angle: 45 },
  { from: '#232526', to: '#414345', angle: 180 },
  { from: '#00b09b', to: '#96c93d', angle: 90 },
  { from: '#8e2de2', to: '#4a00e0', angle: 135 },
  { from: '#ed213a', to: '#93291e', angle: 90 },
  { from: '#12c2e9', to: '#f64f59', angle: 45 },
  { from: '#fc466b', to: '#3f5efb', angle: 90 },
];

export const PRESET_COLORS = ['#ffffff', '#1e293b', '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

export const PRESET_GRADIENTS = [
  'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)',
  'linear-gradient(45deg, #1e293b 0%, #0f172a 100%)',
];
