import type { ToolDefinition } from '../types.ts';
import { ALIGN_MODES, DISTRIBUTE_MODES, EDIT_LAYER_RULES, PROJECT_RULES, fieldUsage } from './requests.ts';

const string = (description: string) => ({ type: 'string', description, maxLength: 200000 });
const numeric = (description: string, minimum = -100000, maximum = 100000) => ({ type: 'number', description, minimum, maximum });
const boolean = (description: string) => ({ type: 'boolean', description });
const enumeration = (description: string, values: string[]) => ({ type: 'string', description, enum: values });
const object = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', description, properties, required, additionalProperties: false });
const layerIds = (description: string) => ({ type: 'array', description, items: string('来自 get_context 或 read_layers 的图层 ID，不可编造。'), minItems: 1, maxItems: 500 });
const tool = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({ type: 'function', function: { name, description, parameters } });
const projectId = string('当前活动项目 ID，来自 get_context；活动项目改变后应重新读取。');
const conditional = <Schema extends { description: string }>(rules: Parameters<typeof fieldUsage>[0], field: string, schema: Schema) => ({ ...schema, description: fieldUsage(rules, field) + schema.description });

const patch = object('图层属性的部分更新；省略字段保持原值。不要提交 id、type、parentId 或 children 等结构字段。', {
  name: string('图层名称，用于图层列表与搜索。'),
  content: string([
    '图层完整内容；修改前先 read_layers，保留无关结构与样式，不接受差异补丁。',
    'text：纯文本。image：已有 HTTP(S) URL 或 PNG/JPEG/WebP/GIF 的 base64 数据 URL。',
    'svg：完整 SVG 标记，禁止脚本、事件、foreignObject、style、动画和外部引用。',
    'decoration：按 decorationFormat 提供 CSS 声明或静态 HTML。CSS 仅支持背景、边框、圆角、阴影、轮廓、裁切、滤镜、混合、透明度和变量；最多 6000 字符、24 条声明（含变量），像素值限制在 -240px 到 240px。布局和尺寸使用图层字段；需要文字、flex/grid 或多节点时使用 HTML。',
    'HTML 最多 24000 字符、300 个元素，允许行内样式及自动隔离的 style 选择器；图片仅允许嵌入位图，不要生成 JSX、Tailwind/CDN 依赖或 data-cf-fragment 标识。',
    '装饰禁止脚本、事件、外部资源、url()/image-set()、CSS at-rule、动画/transition、fixed/sticky、pointer-events 和视口单位；使用百分比或像素。',
    '装饰颜色定义为具体 CSS 变量后用 var() 引用，例如 --accent:#38bdf8; --surface:rgba(255,255,255,0.24)。支持 HEX、RGBA、HSL、OKLCH 和命名颜色。调色时更新相应变量并保留 alpha，不使用图层 color 或 currentColor 主色绑定。'
  ].join('\n')),
  color: string('仅用于文字和 SVG 的主色。装饰图层禁止此字段，必须修改 content 中的颜色变量。'),
  fontFamily: string('仅用于文字：CSS font-family 值，可包含字体族及回退字体，例如 "Microsoft YaHei", sans-serif。'),
  fontWeight: {
    description: '仅用于文字：CSS 字重，可使用数字或字符串。',
    anyOf: [string('CSS 字重关键字，例如 normal、bold。'), numeric('数字字重，例如 400 或 700。', 1, 1000)]
  },
  x: numeric('图层左上角水平位置，单位为画布像素。'),
  y: numeric('图层左上角垂直位置，单位为画布像素。'),
  width: numeric('图层宽度，单位为画布像素；等比锁定时只改宽度会同步高度。', 1),
  height: numeric('图层高度，单位为画布像素；等比锁定时只改高度会同步宽度。', 1),
  rotation: numeric('图层旋转角度，单位为度。'),
  zIndex: numeric('图层堆叠顺序，值越大越靠前；置顶/置底用 front/back，上移/下移一层用 forward/backward。'),
  opacity: numeric('整层透明度，0 为完全透明、1 为完全不透明；与颜色 alpha 叠加。', 0, 1),
  fontSize: numeric('仅用于文字：字号，单位为像素。', 1),
  visible: boolean('是否显示图层。'),
  locked: boolean('是否锁定图层；编辑锁定图层前须获用户许可并单独提交 locked:false 解锁。'),
  ratioLocked: boolean('是否锁定宽高比例。'),
  textAlign: enumeration('仅用于文字：水平文本对齐方式。', ['left', 'center', 'right']),
  writingMode: enumeration('仅用于文字：horizontal 为横排，vertical 为竖排。', ['horizontal', 'vertical']),
  decorationFormat: enumeration('仅用于装饰：css 是单元素外观声明，html 是静态多节点标记。新增时省略则自动识别；更新时保留原格式。切换格式须同时提交完整 content。', ['css', 'html']),
  textGradient: object('仅用于文字：完整渐变配置，提交时必须包含全部子字段。', {
    enabled: boolean('是否启用文字渐变；关闭时恢复 color 主色。'),
    from: string('渐变起始颜色，使用 CSS 颜色值。'),
    to: string('渐变结束颜色，使用 CSS 颜色值。'),
    angle: numeric('线性渐变方向，单位为度。')
  }, ['enabled', 'from', 'to', 'angle']),
  textShadow: object('仅用于文字：完整阴影配置，提交时必须包含全部子字段。', {
    enabled: boolean('是否启用文字阴影。'),
    color: string('阴影的 CSS 颜色值，可含透明度。'),
    blur: numeric('阴影模糊半径，单位为像素，不得为负。', 0),
    offsetX: numeric('阴影水平偏移，单位为像素，负值向左。'),
    offsetY: numeric('阴影垂直偏移，单位为像素，负值向上。')
  }, ['enabled', 'color', 'blur', 'offsetX', 'offsetY'])
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_context', '读取当前项目、画布、背景、选区及图层元数据；不含图层源码，源码请用 read_layers 读取。', object('无需参数。', {})),
  tool('get_cover_size_recommendations', '获取常见封面尺寸、比例及适配建议，供新建封面或选择画布尺寸时参考。', object('无需参数。', {})),
  tool('manage_projects', '搜索和管理项目。新建会自动打开；删除需用户确认，本地文件项目只移除最近记录而不删除磁盘文件。', object('项目管理请求；除 action 外的字段是否需要取决于所选操作。', {
    action: enumeration('list 为分页搜索；create 为新建；open 为打开；rename 为重命名；duplicate 为复制；delete 为删除；save 为保存。', Object.keys(PROJECT_RULES)),
    projectId: conditional(PROJECT_RULES, 'projectId', string('来自 manage_projects/list 或 get_context，不可编造。')),
    query: conditional(PROJECT_RULES, 'query', string('按项目名称搜索；省略表示不过滤，提供时不得为空白。')),
    title: conditional(PROJECT_RULES, 'title', string('项目名称，不得为空白。create 省略为 Untitled；duplicate 省略自动追加 (copy)。')),
    page: conditional(PROJECT_RULES, 'page', { type: 'integer', description: '页码，从 1 开始，省略为 1。', minimum: 1, maximum: 100000 }),
    pageSize: conditional(PROJECT_RULES, 'pageSize', { type: 'integer', description: '每页项目数量，省略为 20。', minimum: 1, maximum: 50 }),
    width: conditional(PROJECT_RULES, 'width', numeric('画布宽度，单位为像素，省略为 1200。', 10, 10000)),
    height: conditional(PROJECT_RULES, 'height', numeric('画布高度，单位为像素，省略为 630。', 10, 10000))
  }, ['action'])),
  tool('read_layers', '读取图层源码及属性，可按 ID 或名称/内容关键词筛选。修改已有源码前先调用此工具。', object('读取当前活动项目内的图层；ID 与关键词过滤同时提供时取交集。', {
    projectId,
    layerIds: layerIds('可选图层 ID 列表；省略时读取所有匹配图层。'),
    query: string('可选名称或内容关键词，不区分大小写；省略时不过滤，提供时不得为空白。')
  }, ['projectId'])),
  tool('get_selected_layers', '读取当前选中图层的属性；视觉模型还会收到选中图片图层的预览。', object('无需参数', {})),
  tool('add_layer', '在当前项目添加一个图层并选中；不会自动编组，多图层组合请使用 edit_layers。', object('新图层创建参数。', {
    projectId,
    type: enumeration('图层类型：text 为纯文本，svg 为矢量标记，image 为已有位图，decoration 为 CSS/HTML 装饰。', ['text', 'svg', 'image', 'decoration']),
    properties: { ...patch, description: '新图层属性，content 必填；省略的位置默认为 (40,40)，宽高为 300×100，透明度为 1。', required: ['content'] }
  }, ['projectId', 'type', 'properties'])),
  tool('edit_layers', '批量修改或组织图层。组合变换会传递到子图层；除单独解锁操作外，锁定图层须先解锁。', object('对当前项目的一组图层执行同一个操作。', {
    projectId,
    action: enumeration('update 更新属性；delete 删除；duplicate 复制；group 编组（至少两个未编组图层，不可嵌套）；ungroup 拆组；front/back 置顶/置底；forward/backward 上移/下移一层，跨过相邻的一个未选中图层，保持选中图层相对顺序，边界不再移动，选择组合时包含子图层；align 对齐画布；distribute 等间距分布（至少三个独立图层）。', Object.keys(EDIT_LAYER_RULES)),
    layerIds: layerIds('操作目标 ID 列表；同一 properties 会应用于全部目标，不应混合需要不同属性的图层。'),
    properties: conditional(EDIT_LAYER_RULES, 'properties', { ...patch, minProperties: 1, description: '待修改字段，至少提供一个；省略的属性保持原值。' }),
    name: conditional(EDIT_LAYER_RULES, 'name', string('组名，不得为空白；省略为 Group。')),
    mode: conditional(EDIT_LAYER_RULES, 'mode', enumeration('align 仅允许 left/center/right（水平对齐）或 top/middle/bottom（垂直对齐）；distribute 仅允许 horizontal/vertical。', [...ALIGN_MODES, ...DISTRIBUTE_MODES]))
  }, ['projectId', 'action', 'layerIds'])),
  tool('update_canvas', '更新当前画布及背景。调整画布尺寸不会缩放已有图层。', object('画布与背景的部分更新；省略的字段保持不变。', {
    projectId,
    width: numeric('画布宽度，单位为像素。', 10, 10000),
    height: numeric('画布高度，单位为像素。', 10, 10000),
    background: object('背景部分更新。切换 type 时应同时提供对应格式的 value；不支持 HTML 背景。CSS 模式省略 overlay。', {
      type: enumeration('color 为纯色，gradient 为 CSS 渐变值，image 为已有图片，css 为自定义背景声明；CSS 模式不能提供 overlay。', ['color', 'gradient', 'image', 'css']),
      value: string('随 type 变化：color 为 CSS 颜色；gradient 为渐变值；image 为已有 HTTP(S) URL 或 PNG/JPEG/WebP/GIF base64 数据 URL；css 为最多 6000 字符的 CSS 声明，仅允许背景属性和变量，不含选择器。自定义 CSS 禁止外部资源、url()/image-set()、CSS at-rule、动画和视口单位；颜色可用含 alpha 的字面量变量。'),
      overlay: object('非 CSS 背景的叠加纹理设置；CSS 背景省略此对象。', {
        type: enumeration('none 为无纹理，dots 为波点，grid 为网格，stripes 为条纹。', ['none', 'dots', 'grid', 'stripes']),
        color: string('纹理颜色，建议使用 #RRGGBB。'),
        opacity: numeric('纹理透明度，0 为完全透明、1 为完全不透明。', 0, 1),
        scale: numeric('纹理尺寸与间距，单位为像素。', 20, 1000)
      })
    })
  }, ['projectId']))
];

export const VISION_TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_canvas_preview', '预览当前画布效果，用于视觉分析；返回缩放后的 WebP 图片。', object('无需参数。', {}))
];