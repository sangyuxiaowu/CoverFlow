import type { ToolDefinition } from '../types.ts';

const string = { type: 'string' };
const numeric = { type: 'number' };
const boolean = { type: 'boolean' };
const enumeration = (values: string[]) => ({ type: 'string', enum: values });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const tool = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({ type: 'function', function: { name, description, parameters } });

const patch = object({
  name: string, content: string, color: string, fontFamily: string, fontWeight: { anyOf: [string, numeric] },
  x: numeric, y: numeric, width: numeric, height: numeric, rotation: numeric, zIndex: numeric,
  opacity: { type: 'number', minimum: 0, maximum: 1 }, fontSize: numeric,
  visible: boolean, locked: boolean, ratioLocked: boolean,
  textAlign: enumeration(['left', 'center', 'right']), writingMode: enumeration(['horizontal', 'vertical']),
  textGradient: object({ enabled: boolean, from: string, to: string, angle: numeric }, ['enabled', 'from', 'to', 'angle']),
  textShadow: object({ enabled: boolean, color: string, blur: numeric, offsetX: numeric, offsetY: numeric }, ['enabled', 'color', 'blur', 'offsetX', 'offsetY'])
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_context', 'Read current project ID, canvas, background, selected IDs and layer metadata. Content is omitted; use read_layers for content.', object({})),
  tool('manage_projects', 'Search/list stored projects (paginated), create, open, rename, duplicate, delete or save a project. IDs come from list/get_context. Delete requires user confirmation. New projects are opened automatically. Local file deletion removes only the recent entry.', object({
    action: enumeration(['list', 'create', 'open', 'rename', 'duplicate', 'delete', 'save']), projectId: string, query: string, title: string,
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 50 }, width: numeric, height: numeric
  }, ['action'])),
  tool('read_layers', 'Read exact layer content and properties, optionally filtering IDs or name/content query. Requires the current project ID.', object({ projectId: string, layerIds: { type: 'array', items: string }, query: string }, ['projectId'])),
  tool('add_layer', 'Add a text, SVG, bitmap image or CSS decoration layer. Group via edit_layers. SVG cannot contain scripts, foreignObject, animation or external links. Bitmap URL must be HTTP(S) or data:image/png,jpeg,webp,gif. Decoration content is CSS, without url() or HTML.', object({ projectId: string, type: enumeration(['text', 'svg', 'image', 'decoration']), properties: patch }, ['projectId', 'type', 'properties'])),
  tool('edit_layers', 'Batch update, delete, duplicate, group, ungroup, move front/back, align to canvas or distribute layers with equal gaps. Group transforms propagate to children. Locked layers must first be unlocked. IDs and parent/child relationships cannot be patched. For align use left/center/right/top/middle/bottom; distribute horizontal/vertical.', object({
    projectId: string, action: enumeration(['update', 'delete', 'duplicate', 'group', 'ungroup', 'front', 'back', 'align', 'distribute']),
    layerIds: { type: 'array', items: string, minItems: 1 }, properties: patch,
    mode: enumeration(['left', 'center', 'right', 'top', 'middle', 'bottom', 'horizontal', 'vertical'])
  }, ['projectId', 'action', 'layerIds'])),
  tool('update_canvas', 'Update current canvas dimensions or background. Canvas resize does not scale existing layers. Positive dimensions 10-10000 pixels.', object({
    projectId: string, width: numeric, height: numeric,
    background: object({ type: enumeration(['color', 'gradient', 'image']), value: string, overlayType: enumeration(['none', 'dots', 'grid', 'stripes']), overlayColor: string, overlayOpacity: numeric, overlayScale: numeric })
  }, ['projectId']))
];