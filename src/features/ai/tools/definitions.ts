import type { ToolDefinition } from '../types.ts';
import { ADD_LAYER_TYPES, ALIGN_MODES, DISTRIBUTE_MODES, PROJECT_MANAGE_RULES, REORDER_POSITIONS } from './requests.ts';

const string = (description: string) => ({ type: 'string', description });
const numeric = (description: string, minimum?: number, maximum?: number) => ({ type: 'number', description, ...(minimum !== undefined ? { minimum } : {}), ...(maximum !== undefined ? { maximum } : {}) });
const boolean = (description: string) => ({ type: 'boolean', description });
const enumeration = (description: string, values: string[]) => ({ type: 'string', description, enum: values });
const object = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', description, properties, ...(required.length ? { required } : {}) });
const layerIds = (description: string) => ({ type: 'array', description, items: string('图层 ID，须来自上下文，不可编造。'), minItems: 1, maxItems: 500 });
const noParameters = { type: 'object', properties: {} };
const tool = (name: string, description: string, parameters: Record<string, unknown>): ToolDefinition => ({ type: 'function', function: { name, description, parameters } });
const layerInfoDefinition = { ...object('通用图层属性。创建和更新时均可选；省略时使用默认值或保留原值。', {
  x: numeric('位置 X，单位 px。'),
  y: numeric('位置 Y，单位 px。'),
  width: numeric('宽度，单位 px。', 1),
  height: numeric('高度，单位 px。', 1),
  rotation: numeric('旋转角度。'),
  opacity: numeric('透明度，0 为透明、1 为不透明。', 0, 1),
  visible: boolean('是否显示。'),
  locked: boolean('是否锁定。'),
  ratioLocked: boolean('是否锁定宽高比例。')
}), minProperties: 1 };

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // 项目管理
  tool('get_cover_size_recommendations', '获取常见封面尺寸、比例及适配建议。', noParameters),
  tool('create_project', '新建并打开项目。', object('', {
    title: string('项目名称，默认 Untitled。'),
    width: numeric('画布宽度，默认 1200px。', 10, 10000),
    height: numeric('画布高度，默认 630px。', 10, 10000)
  })),
  tool('search_projects', '按名称搜索项目。', object('查询条件', {
    query: string('搜索关键词。默认为空，返回全部'),
    page: { type: 'integer', description: '页码，默认 1。', minimum: 1 },
    pageSize: { type: 'integer', description: '每页数量，默认 20。', minimum: 1, maximum: 50 }
  })),
  tool('manage_projects', '打开、重命名、复制、删除或保存项目。删除会触发授权弹窗。', object('', {
    action: enumeration('操作', Object.keys(PROJECT_MANAGE_RULES)),
    projectId: string('目标项目 ID，来自 get_context 或 search_projects，不限于当前项目。'),
    title: string('项目名称，rename 必填，duplicate 省略时自动追加 (copy)。')
  }, ['action', 'projectId'])),
  // 素材管理
  tool('search_assets', '搜索素材文件夹中的素材。', object('搜索条件', {
    query: { ...string('[可选] 关键词，匹配名称、ID、相对路径或中英文分类，不区分大小写；省略或空白返回全部。'), maxLength: 1000 },
    type: enumeration('[可选] 素材类型。', ['svg', 'image']),
    page: { type: 'integer', description: '页码，默认 1。', minimum: 1, maximum: 1000000 },
    pageSize: { type: 'integer', description: '每页数量，默认 20。', minimum: 1, maximum: 50 }
  })),
  tool('place_asset', '添加指定素材为置顶图层，选中并返回图层 ID。', object('放置参数。', {
    assetId: string('精确文件夹素材 ID，来自 search_assets 或规则中的已知引用，例如 folder:Brand-品牌/logo.svg。区分大小写。'),
    x: numeric('[可选] 左上角 X，单位 px；省略水平居中。'),
    y: numeric('[可选] 左上角 Y，单位 px；省略垂直居中。'),
    width: numeric('[可选] 宽度，单位 px；只传宽度时按原比例计算高度。宽高均省略时不放大，等比缩小到画布内且最长边不超过 300px。', 1),
    height: numeric('[可选] 高度，单位 px；只传高度时按原比例计算宽度。同时提供宽高必须保持原比例。', 1)
  }, ['assetId'])),
  // 图层管理
  tool('clipboard', '临时剪贴板管理，可跨项目页面进行复制粘贴引用；同页按原堆叠顺序，不同来源页按首次加入顺序置顶。', object('剪贴板操作参数。', {
    action: enumeration('check 查看、clear 清空、copy 添加、paste 粘贴。', ['check', 'clear', 'copy', 'paste']),
    layers: { type: 'array', description: '仅 copy 使用；图层引用列表。', minItems: 1, maxItems: 500, items: object('图层引用。', {
      projectId: string('[可选] 来源项目 ID，省略时使用当前项目。'), 
      pageId: string('[可选] 来源页面 ID，省略时使用当前页面。'), 
      layerId: string('来源图层 ID。'),
      info: { ...string('可选的简短备注，原样返回，不要填写图层内容或数据 URL。'), maxLength: 200 }
    }, ['layerId']) },
    projectId: string('[可选] 仅 paste 使用，目标项目 ID，省略时使用当前项目。'),
    pageId: string('[可选] 仅 paste 使用，目标页面 ID，省略时使用当前页面。')
  }, ['action'])),
  tool('get_context', '读取项目页面列表、当前页画布、背景、选区及图层元数据。图层工具仅操作当前页，跨页前使用 manage_pages 切换。', noParameters),
  tool('read_layers', '读取图层属性，含图层详细内容，内嵌图片内容使用占位符。可按 ID 或名称/内容关键词筛选，同时提供时取交集。修改已有内容前先调用。', object('', {
    pageId: string('[可选]目标页面 ID，省略时读取当前页面。'),
    layerIds: layerIds('可选；省略时读取所有匹配图层。'),
    query: string('可选名称或内容关键词，不区分大小写；省略时不过滤，提供时不得为空白。')
  })),
  tool('get_selected_layers', '读取当前选中图层属性。视觉模型还会收到图片预览。用户输入有明确指代时使用。', noParameters),
  tool('add_layers', '批量添加图层并选中最后一个，返回创建的图层 ID；任一图层无效时整批不创建。', object('图层创建参数。', {
    layers: { type: 'array', description: '待创建的图层，按数组顺序从下到上置顶。', minItems: 1, maxItems: 500, items: object('单个图层的创建参数。', {
    type: enumeration('图层类型。properties 必须包含同名属性组及其 content，不得提供其他类型的属性组。', [...ADD_LAYER_TYPES]),
    properties: object('图层名称作为 name 单独填写；其他通用属性填写在 layerInfo 分组；类型专属属性只填写与 type 同名的 text/image/svg/decoration 分组，且该组 content 必填。省略名称使用默认名称；省略位置默认为 (40,40)，宽高默认为 300×100，透明度默认为 1；新图层默认置顶。', {
      name: string('图层名称，用于图层列表与搜索。'),
      layerInfo: layerInfoDefinition,
      text: object('文字图层专属属性，type 为 text 时必填。', {
        content: string('必填：完整纯文本内容。'),
        color: string('文字主色，使用 CSS 颜色值。'),
        fontFamily: string('CSS font-family 值，优先将 list_fonts 返回的 family 用双引号包裹后使用，例如 "Noto Sans SC"。Google 精选字体按需联网加载，本地字体需在当前设备安装。'),
        fontWeight: {
          description: 'CSS 字重，可使用数字或字符串。',
          anyOf: [string('CSS 字重关键字，例如 normal、bold。'), numeric('数字字重，例如 400 或 700。', 1, 1000)]
        },
        fontSize: numeric('字号（px）。', 1),
        letterSpacing: numeric('字距（px），默认 0，支持负值和小数。'),
        lineHeight: numeric('行高（字号倍数），默认 1.1，范围 0.5–5；支持小数，竖排时控制列间距。', 0.5, 5),
        textAlign: enumeration('水平文本对齐方式。', ['left', 'center', 'right']),
        writingMode: enumeration('文本排列方式。', ['horizontal', 'vertical']),
        textGradient: object('文字渐变配置。', {
          enabled: boolean('是否启用；关闭时恢复 color 主色。'),
          from: string('渐变起始颜色，使用 CSS 颜色值。'),
          to: string('渐变结束颜色，使用 CSS 颜色值。'),
          angle: numeric('线性渐变方向，单位为度。')
        }, ['enabled', 'from', 'to', 'angle']),
        textShadow: object('文字阴影配置。', {
          enabled: boolean('是否启用。'),
          color: string('阴影的 CSS 颜色值，可含透明度。'),
          blur: numeric('阴影模糊半径（px），不得为负。', 0),
          offsetX: numeric('阴影水平偏移（px），负值向左。'),
          offsetY: numeric('阴影垂直偏移（px），负值向上。')
        }, ['enabled', 'color', 'blur', 'offsetX', 'offsetY'])
      }, ['content']),
      image: object('图片图层专属属性，type 为 image 时必填。', {
        content: string('必填：已有 HTTP(S) 图片 URL 或 PNG/JPEG/WebP/GIF 的 base64 数据 URL；不接受 SVG 图片。'),
        imageSource: { ...string('图片来源，例如 upload、import 或实际生图模型名称。'), maxLength: 200 },
        imageDescription: { ...string('图片描述或实际生成该图片的提示词。'), maxLength: 10000 },
        flipX: boolean('是否水平（左右）翻转。'),
        flipY: boolean('是否垂直（上下）翻转。'),
        imageFilters: { ...object('滤镜设置。', {
          brightness: numeric('亮度百分比，100 为原始亮度，0 为全黑，200 为两倍亮度。', 0, 200),
          contrast: numeric('对比度百分比，100 为原始对比度，0 为无对比度，200 为两倍对比度。', 0, 200),
          grayscale: numeric('灰度百分比，0 为原色，100 为完全黑白灰度。', 0, 100),
          blur: numeric('高斯模糊半径，单位为像素，0 为不模糊。', 0, 20)
        }), minProperties: 1 },
        imageCrop: { ...object('非破坏性裁剪区域，基于原图宽高百分比；完整原图为 x:0,y:0,width:100,height:100。', {
          x: numeric('裁剪区域左上角水平起始百分比。', 0, 100),
          y: numeric('裁剪区域左上角垂直起始百分比。', 0, 100),
          width: numeric('裁剪区域宽度百分比；x + width 不得超过 100。', 1, 100),
          height: numeric('裁剪区域高度百分比；y + height 不得超过 100。', 1, 100)
        }), minProperties: 1 }
      }, ['content']),
      svg: object('SVG 图层专属属性，type 为 svg 时必填。', {
        content: string('必填：完整 SVG 标记。禁止脚本、事件、foreignObject、style、动画和外部引用。'),
        color: string('[可选] SVG 主色，currentColor，使用 CSS 颜色值。')
      }, ['content']),
      decoration: object('装饰图层专属属性，type 为 decoration 时必填。', {
        content: string('必填：完整 CSS 声明或静态 HTML。建议使用var定义必要的颜色，以便用户后续自行调整。1. CSS 声明会直接作用于装饰容器，不得包含选择器或规则花括号，示例：`--accent: rgba(255,255,255,0.5); background: var(--accent); border-radius: 8px;`。2. 静态 HTML：需要显示文字、布局子元素或使用选择器时，用 HTML 元素，并建议把选择器规则放进 <style> 标签。必须包含实际显示的文字节点。HTML 示例：`<style>:root { --accent: rgba(255,255,255,0.5); } span { display: block; color: var(--accent);line-height: 30px; }</style><span>文本</span>`。CSS 最多 6000 字符、24 条声明；HTML 最多 24000 字符、300 个元素。禁止脚本、事件、外部资源、url()/image-set()、CSS at-rule、动画/transition、fixed/sticky、pointer-events 和视口单位，图片仅允许嵌入位图。')
      }, ['content'])
    })
    }, ['type', 'properties']) }
  }, ['layers'])),
  tool('update_layers', '批量更新图层通用属性或对应类型的专属属性。组合变换会传递到子图层；锁定图层须先单独解锁。', object('图层属性更新参数。', {
    layerIds: layerIds('操作目标 ID 列表；同一属性补丁会应用于全部目标，不要混合需要不同属性的图层。'),
    properties: { ...object('更新图层属性。name 单独填写；图层属性放在 layerInfo，类型专属字段放在 image/text/svg/decoration 分组。字段列表与限制见 add_layers 和读取工具定义；省略字段保持原值。结构字段、zIndex 及只读属性不可更新。', {}), minProperties: 1 }
  }, ['layerIds', 'properties'])),
  tool('delete_layers', '删除图层，删除组合时包含子图层；锁定图层须先解锁。', object('图层删除参数。', {
    layerIds: layerIds('要删除的图层 ID。')
  }, ['layerIds'])),
  tool('duplicate_layers', '复制图层，复制组合时包含子图层；锁定图层须先解锁。', object('图层复制参数。', {
    layerIds: layerIds('要复制的图层 ID。')
  }, ['layerIds'])),
  tool('group_layers', '将图层编为一组；锁定图层须先解锁。', object('图层编组参数。', {
    layerIds: { ...layerIds('至少两个未编组的图层 ID；不支持嵌套组合。'), minItems: 2 },
    name: string('组名，不得为空白；省略为 Group。')
  }, ['layerIds'])),
  tool('ungroup_layers', '拆开组合并保留子图层；锁定组合须先解锁。', object('图层拆组参数。', {
    layerIds: layerIds('要拆开的 group 图层 ID，不接受普通图层。')
  }, ['layerIds'])),
  tool('reorder_layers', '调整图层堆叠顺序，保持多选相对顺序；组合包含子图层，锁定图层须先解锁。', object('图层排序参数。', {
    layerIds: layerIds('要调整堆叠顺序的图层 ID。'),
    position: enumeration('front/back 为置顶/置底；forward/backward 为上移/下移一层，跨过相邻的一个未选中图层，到达边界不再移动。', [...REORDER_POSITIONS])
  }, ['layerIds', 'position'])),
  tool('align_layers', '将图层对齐到画布，组合变换传递到子图层；锁定图层须先解锁。', object('图层对齐参数。', {
    layerIds: layerIds('要对齐的图层 ID。'),
    mode: enumeration('left/center/right 为画布水平对齐，top/middle/bottom 为画布垂直对齐。', [...ALIGN_MODES])
  }, ['layerIds', 'mode'])),
  tool('distribute_layers', '在现有首尾边界之间等间距分布图层；锁定图层须先解锁。', object('图层分布参数。', {
    layerIds: { ...layerIds('至少三个独立图层 ID；不能同时选择组合及其子图层。'), minItems: 3 },
    mode: enumeration('horizontal 为水平等间距，vertical 为垂直等间距。', [...DISTRIBUTE_MODES])
  }, ['layerIds', 'mode'])),
  // 画布与背景
  tool('manage_pages', '管理项目页面。获取页面列表，更新页面画布大小、背景及名称，页面切换，页面移动，批量新增与复制；调整页面画布尺寸不会缩放已有图层；删除会触发授权弹窗。', object('页面操作参数。', {
    action: enumeration('list 读取页面列表；create 在 afterPageId 后新增空白页；switch 切页；duplicate 复制目标页到 afterPageId 后；move 移动目标页到 afterPageId 后；update 更新目标页属性；delete 删除目标页，至少保留一页。', ['list', 'create', 'switch', 'duplicate', 'delete', 'move', 'update']),
    count: { type: 'integer', description: '仅 create/duplicate 可用；批量创建或复制的页面数量，默认 1。', minimum: 1, maximum: 99 },
    pageId: string('目标页，除 list/create 外均需填写，使用 get_context 或 list 返回的稳定页面 ID，不是顺序编号。'),
    afterPageId: string('仅 create/duplicate/move 可用；省略则为当前页。'),
    autoSwitch: { type: 'boolean', description: '[可选]，是否在创建、移动或复制成功后自动切换到新页，多页则为第一个新页，默认 true。' },
    name: { ...string('仅 create/update 可用的页面名称，最多 100 字符；新建时省略或空白表示沿用当前页，更新时省略保持不变，空白表示清除名称。'), maxLength: 100 },
    pageInfo: { ...object('仅 create/update 可用的画布和背景属性；新建时省略字段沿用当前页，更新时省略的字段保持不变。update 至少提供 name 或 pageInfo。', {
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
    }), minProperties: 1 }
  }, ['action'])),
];

export const VISION_TOOL_DEFINITIONS: ToolDefinition[] = [
  tool('get_canvas_preview', '预览当前画布效果，用于视觉分析；返回缩放后的图片。', noParameters)
];
