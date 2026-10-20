import type { ImagePromptConfig, ToolDefinition } from '../types.ts';
import { imageCapabilities, imageTimeoutSeconds } from '../image-generation/index.ts';
import { ALIGN_MODES, DISTRIBUTE_MODES, EDIT_LAYER_RULES, PROJECT_RULES, fieldUsage } from './requests.ts';

const string = (description: string) => ({ type: 'string', description, maxLength: 200000 });
const numeric = (description: string, minimum = -100000, maximum = 100000) => ({ type: 'number', description, minimum, maximum });
const boolean = (description: string) => ({ type: 'boolean', description });
const enumeration = (description: string, values: string[]) => ({ type: 'string', description, enum: values });
const object = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', description, properties, required, additionalProperties: false });
const layerIds = (description: string) => ({ type: 'array', description, items: string('来自 get_context 或 read_layers 的图层 ID，不可编造。'), minItems: 1, maxItems: 500 });
const noParameters = { type: 'object', properties: {} };
const tool = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({ type: 'function', function: { name, description, parameters } });
const projectId = string('当前活动项目 ID，来自 get_context；活动项目改变后应重新读取。');
const conditional = <Schema extends { description: string }>(rules: Parameters<typeof fieldUsage>[0], field: string, schema: Schema) => ({ ...schema, description: fieldUsage(rules, field) + schema.description });

const patch = object('图层属性的部分更新；省略字段保持原值。不要提交 id、type、parentId 或 children 等结构字段。', {
  name: string('图层名称，用于图层列表与搜索。'),
  image: { ...object('图片图层属性；仅 image 图层可提供。', {
    imageSource: { ...string('图片来源，例如 upload、import 或实际生图模型 ID。'), maxLength: 200 },
    imageDescription: { ...string('图片描述或实际生成该图片的提示词。'), maxLength: 10000 },
    flipX: boolean('是否水平（左右）翻转；开启已有非破坏性裁剪时会自动镜像裁剪区域。'),
    flipY: boolean('是否垂直（上下）翻转；开启已有非破坏性裁剪时会自动镜像裁剪区域。'),
    imageFilters: { ...object('基础滤镜配置，可提交部分或全部子字段；省略子字段保持当前值。全部恢复默认值（brightness:100, contrast:100, grayscale:0, blur:0）即可重置滤镜。', {
      brightness: numeric('亮度百分比，100 为原始亮度，0 为全黑，200 为两倍亮度。', 0, 200),
      contrast: numeric('对比度百分比，100 为原始对比度，0 为无对比度，200 为两倍对比度。', 0, 200),
      grayscale: numeric('灰度百分比，0 为原色，100 为完全黑白灰度。', 0, 100),
      blur: numeric('高斯模糊半径，单位为像素，0 为不模糊。', 0, 20)
    }), minProperties: 1 },
    imageCrop: { ...object('非破坏性裁剪区域（基于原图宽高的百分比），可提交部分或全部子字段；未同时传入图层宽高时会自动按裁剪区域同步图层尺寸与中心。设为 x:0, y:0, width:100, height:100 可重置裁剪并恢复完整原图。', {
      x: numeric('裁剪区域左上角水平起始百分比（0-100）。', 0, 100),
      y: numeric('裁剪区域左上角垂直起始百分比（0-100）。', 0, 100),
      width: numeric('裁剪区域宽度占原图宽度的百分比（1-100），且 x + width 不超过 100。', 1, 100),
      height: numeric('裁剪区域高度占原图高度的百分比（1-100），且 y + height 不超过 100。', 1, 100)
    }), minProperties: 1 }
  }), minProperties: 1 },
  text: { ...object('文字图层属性；仅 text 图层可提供。', {
    fontFamily: string('CSS font-family 值，可包含字体族及回退字体，例如 "Microsoft YaHei", sans-serif。'),
    fontWeight: {
      description: 'CSS 字重，可使用数字或字符串。',
      anyOf: [string('CSS 字重关键字，例如 normal、bold。'), numeric('数字字重，例如 400 或 700。', 1, 1000)]
    },
    fontSize: numeric('字号，单位为像素。', 1),
    textAlign: enumeration('水平文本对齐方式。', ['left', 'center', 'right']),
    writingMode: enumeration('horizontal 为横排，vertical 为竖排。', ['horizontal', 'vertical']),
    textGradient: object('完整渐变配置，提交时必须包含全部子字段。', {
      enabled: boolean('是否启用文字渐变；关闭时恢复 color 主色。'),
      from: string('渐变起始颜色，使用 CSS 颜色值。'),
      to: string('渐变结束颜色，使用 CSS 颜色值。'),
      angle: numeric('线性渐变方向，单位为度。')
    }, ['enabled', 'from', 'to', 'angle']),
    textShadow: object('完整阴影配置，提交时必须包含全部子字段。', {
      enabled: boolean('是否启用文字阴影。'),
      color: string('阴影的 CSS 颜色值，可含透明度。'),
      blur: numeric('阴影模糊半径，单位为像素，不得为负。', 0),
      offsetX: numeric('阴影水平偏移，单位为像素，负值向左。'),
      offsetY: numeric('阴影垂直偏移，单位为像素，负值向上。')
    }, ['enabled', 'color', 'blur', 'offsetX', 'offsetY'])
  }), minProperties: 1 },
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
  x: numeric('图层左上角水平位置，单位为画布像素。'),
  y: numeric('图层左上角垂直位置，单位为画布像素。'),
  width: numeric('图层宽度，单位为画布像素；等比锁定时只改宽度会同步高度。', 1),
  height: numeric('图层高度，单位为画布像素；等比锁定时只改高度会同步宽度。', 1),
  rotation: numeric('图层旋转角度，单位为度。'),
  zIndex: numeric('图层堆叠顺序，值越大越靠前；置顶/置底用 front/back，上移/下移一层用 forward/backward。'),
  opacity: numeric('整层透明度，0 为完全透明、1 为完全不透明；与颜色 alpha 叠加。', 0, 1),
  visible: boolean('是否显示图层。'),
  locked: boolean('是否锁定图层；编辑锁定图层前须获用户许可并单独提交 locked:false 解锁。'),
  ratioLocked: boolean('是否锁定宽高比例。'),
  decorationFormat: enumeration('仅用于装饰：css 是单元素外观声明，html 是静态多节点标记。新增时省略则自动识别；更新时保留原格式。切换格式须同时提交完整 content。', ['css', 'html']),
});

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_context', '读取当前项目、画布、背景、选区及图层元数据；不含图层源码，源码请用 read_layers 读取。', noParameters),
  tool('get_cover_size_recommendations', '获取常见封面尺寸、比例及适配建议，供新建封面或选择画布尺寸时参考。', noParameters),
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
  tool('get_selected_layers', '读取当前选中图层的属性，包括图片来源、描述或提示词；视觉模型还会收到图片预览。用户输入有明确指代时使用。', noParameters),
  tool('remove_background', '移除图片图层背景，成功后返回结果图层 ID；已抠图图片不可重复处理。', object('处理当前项目的一个图片图层。', {
    projectId,
    layerId: string('当前项目的 image 图层 ID，来自 get_context、get_selected_layers 或 read_layers，不可编造。锁定图层须先获用户许可解锁。'),
    modelId: enumeration('可选，默认 u2netp，内置的轻量模型，优先用于快速处理、普通主体。birefnet：Lite 512 版本，适合普通主体和复杂边缘处理。modnet：人像专用抠图', ['u2netp', 'birefnet', 'modnet']),
    keepOriginal: boolean('可选，默认 true：成功后保留并隐藏原图，在相同位置创建已抠图副本并选中。'),
    device: enumeration('可选，默认 auto：优先 WebGPU，失败回退 CPU/WASM。', ['auto', 'webgpu', 'wasm'])
  }, ['projectId', 'layerId'])),
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
    width: numeric('画布宽度（px）。', 10, 10000),
    height: numeric('画布高度（px）。', 10, 10000),
    background: object('背景部分更新。切换 type 时应同时提供对应格式的 value。', {
      type: enumeration('背景类型：color(纯色), gradient(CSS渐变), image(图片), css(自定义CSS)。', ['color', 'gradient', 'image', 'css']),
      value: string('随 type 变化：\n1. color: CSS 颜色\n2. gradient: CSS 渐变\n3. image: HTTP(S) URL 或 PNG/JPEG/WebP/GIF Base64\n4. css: CSS 声明（≤6000字符，仅限背景属性和变量，禁止选择器）。注意：禁止外部资源、url()/image-set()、@rule、动画、视口单位。'),
      overlay: object('叠加纹理设置，使用css背景时不支持', {
        type: enumeration('纹理类型：none(无), dots(波点), grid(网格), stripes(条纹)。', ['none', 'dots', 'grid', 'stripes']),
        color: string('纹理颜色，如 #RRGGBB。'),
        opacity: numeric('透明度（0-1）', 0, 1),
        scale: numeric('尺寸与间距（px）', 20, 1000)
      })
    })
  }, ['projectId']))
];

export const VISION_TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_canvas_preview', '预览当前画布效果，用于视觉分析；返回缩放后的图片。', noParameters)
];

export const IMAGE_TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('list_image_models', '读取可用生图模型，能力及参数信息', noParameters),
  tool('generate_image', '生成或修改图像。成功后自动添加图片图层并返回图层 ID，可继续用 edit_layers 调整。注意：referenceImageId 和 referenceLayerId 互斥，都不传则为文生图。', object('生图请求', {
    projectId,
    modelConfigId: { ...string('模型 ID'), maxLength: 9 },
    prompt: { type: 'string', maxLength: 10000, minLength: 1, description: '生图提示词' },
    size: string('输出尺寸，省略使用配置默认值。根据用法选择合适的尺寸即可，分辨率越高生图越慢。'),
    ratio: string('宽高比(如16:9)。仅部分模型支持，当不传 size 时生效'),
    quality: string('生成质量。越高越慢，省略用默认值。'),
    referenceImageId: string('[可选] 当前会话附件 ID。与 referenceLayerId 互斥。'),
    referenceLayerId: string('[可选] 项目 image 图层 ID，可查 get_selected_layers。与 referenceImageId 互斥。')
  }, ['projectId', 'modelConfigId', 'prompt']))
];

export function imageToolDefinitions(models: ImagePromptConfig[] = []): ToolDefinition[] {
  const single = models.length === 1 ? models[0] : undefined;
  return IMAGE_TOOL_DEFINITIONS.filter(definition => !single || definition.function.name !== 'list_image_models').map(definition => {
    if (definition.function.name !== 'generate_image') return definition;
    const parameters = definition.function.parameters;
    const properties = parameters.properties as Record<string, Record<string, unknown>>;
    const next = { ...properties };
    let required = ['projectId', 'modelConfigId', 'prompt'];
    if (single) {
      delete next.modelConfigId;
      required = ['projectId', 'prompt'];
      next.prompt = { ...properties.prompt, description: [
        `生图提示词。${single.label}：${single.description}`,
        `版本：${single.version?.trim() || '未提供'}；发布日期：${single.releasedAt || '未提供'}；生成等待超时：${imageTimeoutSeconds(single)} 秒`
      ].join('\n\n') };
      const capabilities = imageCapabilities(single);
      next.size = { ...properties.size, description: `${properties.size.description} 默认值：${single.size}；${capabilities.exactSizeSupported ? '推荐尺寸' : '支持尺寸'}：${capabilities.sizes.join('、')}。` };
      if (!capabilities.ratios) delete next.ratio;
      else next.ratio = { type: 'string', description: `仅档位尺寸使用；省略为 ${single.ratio}。`, enum: capabilities.ratios };
      if (!capabilities.qualities) delete next.quality;
      else next.quality = { type: 'string', description: `生成质量。越高越慢，省略为 ${single.quality ?? 'high'}。`, enum: capabilities.qualities };
    } else {
      next.modelConfigId = { ...properties.modelConfigId, ...(models.length ? { enum: models.map(model => model.id) } : {}) };
    }
    return { ...definition, function: { ...definition.function, parameters: {
      ...parameters, properties: next, required
    } } };
  });
}