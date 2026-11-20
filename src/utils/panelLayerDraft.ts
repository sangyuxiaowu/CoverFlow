import type { Layer } from '../types.ts';

export const PANEL_LAYER_DRAFT = 'coverflow:panel-layer-draft';
export type PanelLayerDraft = { pageKey: string; layerId: string; updates: Partial<Layer> };