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
  decorationFormat: enumeration(['css', 'html']),
  textGradient: object({ enabled: boolean, from: string, to: string, angle: numeric }, ['enabled', 'from', 'to', 'angle']),
  textShadow: object({ enabled: boolean, color: string, blur: numeric, offsetX: numeric, offsetY: numeric }, ['enabled', 'color', 'blur', 'offsetX', 'offsetY'])
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_context', '读取当前项目 ID、画布、背景、选中 ID 和图层元数据。此处不包含图层内容；需要内容时请调用 read_layers。', object({})),
  tool('manage_projects', '搜索或分页列出已存储项目，也可创建、打开、重命名、复制、删除或保存项目。ID 应来自 list 或 get_context。删除前必须获得用户确认。新建项目会自动打开。删除本地文件项目只会移除其最近项目记录。', object({
    action: enumeration(['list', 'create', 'open', 'rename', 'duplicate', 'delete', 'save']), projectId: string, query: string, title: string,
    page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 50 }, width: numeric, height: numeric
  }, ['action'])),
  tool('read_layers', '读取指定图层的完整内容和属性，可按 ID 或名称/内容关键词筛选。必须提供当前项目 ID。', object({ projectId: string, layerIds: { type: 'array', items: string }, query: string }, ['projectId'])),
  tool('add_layer', '添加文本、SVG、位图或装饰图层。装饰图层支持 CSS 声明，或包含行内样式和局部作用域 style 标签的静态 HTML；请将 decorationFormat 设为 css 或 html。禁止脚本、外部资源、CSS at-rule、动画、固定定位和视口单位；尺寸请使用百分比或像素。装饰颜色请用 CSS 变量定义（如 --accent:#38bdf8; background:var(--accent)），不要使用图层 color 字段。SVG 禁止脚本、foreignObject、动画和外部链接。位图 URL 必须是 HTTP(S) 或 data:image/png、jpeg、webp、gif。', object({ projectId: string, type: enumeration(['text', 'svg', 'image', 'decoration']), properties: patch }, ['projectId', 'type', 'properties'])),
  tool('edit_layers', '批量更新、删除、复制、编组、取消编组、置于顶层/底层、对齐画布或按等间距分布图层。编组变换会传递到子图层。锁定图层必须先解锁。不能通过此工具修改 ID 或父子关系。对齐 mode 使用 left/center/right/top/middle/bottom；分布 mode 使用 horizontal/vertical。', object({
    projectId: string, action: enumeration(['update', 'delete', 'duplicate', 'group', 'ungroup', 'front', 'back', 'align', 'distribute']),
    layerIds: { type: 'array', items: string, minItems: 1 }, properties: patch,
    mode: enumeration(['left', 'center', 'right', 'top', 'middle', 'bottom', 'horizontal', 'vertical'])
  }, ['projectId', 'action', 'layerIds'])),
  tool('update_canvas', '更新画布尺寸或背景。CSS 背景只允许背景相关声明和 CSS 变量；禁止选择器、url()、外部资源和视口单位。调整画布尺寸不会缩放图层。宽高必须是 10 到 10000 之间的正数，单位为像素。', object({
    projectId: string, width: numeric, height: numeric,
    background: object({ type: enumeration(['color', 'gradient', 'image', 'css']), value: string, overlayType: enumeration(['none', 'dots', 'grid', 'stripes']), overlayColor: string, overlayOpacity: numeric, overlayScale: numeric })
  }, ['projectId']))
];