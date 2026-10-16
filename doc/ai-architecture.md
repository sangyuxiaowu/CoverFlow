# CoverFlow AI 模块

## 目录职责

```text
features/ai/
  types.ts                    协议与工作区桥接契约
  domain/layerOperations.ts   纯图层规则、分组几何与批量操作
  domain/floatingGeometry.ts  浮窗位置与尺寸边界
  tools/definitions.ts        模型可见的 JSON Schema
  tools/requests.ts           动作契约、派生联合类型与请求解析
  tools/validation.ts         运行时白名单、数值范围及内容安全校验
  tools/execute.ts            工具分发与当前项目 ID 校验
  services/config.ts          多接入点、多模型、思考参数及配置校验
  services/configStore.ts     IndexedDB 配置与 AES-GCM 加密密钥存储
  services/chatStore.ts       浏览器/文件双模式配置、会话与界面状态
  services/chatFileAccess.ts  File System Access 与 Tauri 文件适配
  services/conversation.ts    OpenAI SDK Responses 事件、原生历史、工具循环
  services/usage.ts           服务端用量汇总、上下文估算与输出预算
  services/workspace.ts       项目生命周期与真实存储适配器
  hooks/useAiAssistant.ts     React 会话、确认、错误和工作区实时值
  hooks/useFloatingPanel.ts   指针拖动、缩放、窗口状态及位置记忆
  hooks/useChatStore.ts       按当前存储模式或原生项目目录选择存储
  components/                聊天面板、模型设置及局部样式
```

沿用项目已有的 React、Vite、lucide-react 和 StorageAdapter，不引入第二套项目存储。参考 SangDocCraft 的 OpenAI 兼容工具调用、浮窗与加密密钥存储设计，按 CoverFlow 的项目和图层模型独立实现。fake-indexeddb 仅用于测试，不进入生产包。

## 模型与浮窗

- 配置包含 endpoints，每个接入点维护独立的 API 地址、Key 与 models；activeSelection 使用接入点 ID 和模型配置 ID，不用模型名称作为唯一标识。
- 接入地址是 SDK baseURL，不填写完整请求地址。DeepSeek 官方使用 https://api.deepseek.com，Ollama 使用 http://localhost:11434/v1。
- 模型分别配置上下文窗口、输出限制、思考能力与支持档位，不再选择思考协议。统一使用 reasoning.effort 和 max_output_tokens，不设置或发送 temperature。DeepSeek 预设支持 none/low/high/max。
- 通过 SDK 读取 Responses 语义事件：正文、原始思考/推理摘要、工具参数以及 completed/incomplete/failed。推理在独立折叠区域显示，不混入最终回答；不同服务商不保证提供相同的可见推理内容。
- DeepSeek 和 Ollama 均采用无状态会话，完整 reasoning/message/function_call 输出与 function_call_output 按顺序保存并回传，不使用 previous_response_id。OpenAI 官方请求关闭服务端存储，并保留返回的加密推理项用于续接。
- 每次终结事件保存 usage（输入、输出、总量及可选缓存/思考明细），按操作及会话汇总；缓存与思考是子集，不额外加到总数。中断或缺失 usage 明确标记未知，已返回的用量仍保留。
- 上次输入实测与下一次上下文估算分开显示。估算采用序列化输入、系统提示词及工具定义的 UTF-8 字节数除以 3，再以同接入点/模型最近实测输入校准；占用比例不是累计消耗除以窗口。预留输出超过预算时提示，不自动丢弃历史。窗口设置是客户端预算，不修改服务端容量。
- 浮窗支持标题栏指针拖动、角落缩放、最小化和最大化，窗口几何写入当前 ChatStore 的界面状态。视口变化后始终限制在可见范围，不再使用 localStorage 保存 AI 界面状态。
- 模型配置异步加载或保存期间禁止发送与切换。读取/解密失败展示可重试错误，禁止用默认配置覆盖旧数据。

## 按模式和会话存储

浏览器 ChatStore 使用 coverflow-ai 数据库中的 settings、endpoint-secrets、sessions 和 ui-state 表。文件 ChatStore 使用以下独立目录布局：

```text
chat/
  config.json             模型、接入点和加密 Key；不含明文密钥
  ui.json                 浮窗位置、尺寸及当前会话 ID
  sessions/
    <session-id>.json     会话标题、项目关联、时间、显示消息与模型 transcript
```

- 浏览器文件模式使用用户已授权的项目存储根目录；Tauri 文件模式使用当前 .cfj 旁的 chat 文件夹。
- 会话有独立 ID，支持新建、选择、重命名和确认删除。每轮开始与结束立即保存，流式显示记录节流保存；刷新后恢复当前会话，并标记未完成工具为中断。
- 完整 Responses 输入历史（responseItems）、逐请求用量（requests）与显示条目一起按会话保存；新会话不会继承其他会话的消息。只使用当前配置与会话结构，不维护开发阶段的旧格式兼容或自动迁移。
- 配置、窗口状态和会话写入各自文件。目录模式使用 FileSystemWritableFileStream.close 提交，Tauri 先写临时文件再重命名。文件路径严格限制会话 ID，不允许路径穿越。
- 切换模式或项目文件目录时重新加载对应存储，禁止把旧请求结果和窗口状态写入新位置。文件权限失败如实展示，不回退到 IndexedDB。
- Tauri 新增 prepare_chat_storage 只为已有文件访问权限的 .cfj 授权其旁的 chat 目录，拒绝链接目录；补充最小创建/列目录/删除/重命名命令权限。

## 数据流

用户消息 -> SDK Responses -> 工具 Schema -> 运行时校验 -> WorkspaceBridge -> App 状态 / StorageAdapter -> function_call_output -> 模型最终回复。

- 工具从实时桥接状态读取，不依赖请求发出时的 React 闭包快照。
- 所有画布修改要求当前 projectId，防止编辑错误项目。
- 每次图层修改提交完整 ProjectState，进入现有历史，并等待存储结果。保存失败会作为工具错误报告；已经显示在画布上的修改不会自动回滚。
- 打开另一项目之前保存当前项目；新建和复制先持久化，成功后更新项目列表。复制会重建所有图层 ID 和父子引用。
- 项目查询使用存储分页接口，另外返回匹配的 Tauri 最近打开项目。当前云存储仍是仓库已有的模拟适配器，不是新建真实云后端。
- Tauri 已打开的文件通过现有本地保存回调写入。删除本地最近项目仅删除记录，不删除磁盘文件。

## 工具能力

工具采用分层 JSON Schema 描述：函数 `description` 只说明用途与整体行为；字段含义、单位、默认值、适用操作及内容限制写在对应参数的 `description` 中，包括嵌套属性、数组元素和联合类型分支。可执行约束用 `enum`、`required`、`minimum/maximum`、`minItems/maxItems` 等表达，执行器仍负责最终校验。新增图层的 `properties.content` 必填，更新图层的 `properties` 则是部分字段补丁。

`edit_layers` 与 `manage_projects` 的动作字段规则集中在 `tools/requests.ts`，用于派生 TypeScript 可辨识联合类型、校验必填/白名单字段，并生成工具参数的条件说明。为兼容自定义模型端点，对外保留扁平对象 Schema 与 `strict:false`，不发送顶层 `oneOf`、OpenAPI `discriminator` 或文档引用；条件约束由运行时执行，不依赖模型遵守说明。所有请求先校验再产生存储或界面副作用。

`edit_layers` 每个动作均要求 `projectId` 和非空 `layerIds`；仅 `update` 接受且必须提供非空 `properties`，仅 `group` 接受顶层可选 `name`，仅 `align/distribute` 接受且必须提供各自动作允许的 `mode`。不再接受通过 `group.properties.name` 命名组。`manage_projects` 的 `list/create` 禁止 `projectId`，其余动作必须提供；`rename.title` 必填，`create/duplicate.title` 可选，其余动作禁止。跨动作字段与未知字段均报错，不忽略。

| 工具 | 功能 |
| --- | --- |
| get_context | 当前项目、画布、背景、选区及图层元数据 |
| manage_projects | list/create/open/rename/duplicate/delete/save |
| read_layers | 按 ID 或名称/内容关键词读取图层 |
| add_layer | text/svg/image/decoration；装饰支持 CSS 声明或静态 HTML |
| edit_layers | update/delete/duplicate/group/ungroup/front/back/forward/backward/align/distribute |
| update_canvas | 画布尺寸及纯色/渐变/图片/自定义 CSS 背景、纹理 |

图层更新支持位置、宽高、旋转、层级、透明度、锁定、显隐、比例锁定、名称、内容、文字颜色/字体/字号/字重/对齐/书写方向/渐变/阴影。结构字段 id/type/parentId/children 不允许直接修改，分组操作负责维护关系。不允许嵌套分组。组合图层变换传递到子图层，子图层变化会刷新组合边界。App 手动图层更新和 AI 更新共用 updateProjectLayer，保持变换规则一致。

层级微调使用 `edit_layers` 的 `action: forward/backward`，分别上移/下移一层，仅需 `projectId` 和 `layerIds`，不接受 `properties/mode/name`。按实际堆叠顺序跨过相邻的一个未选中图层，不是简单增减 `zIndex`；多选保持相对顺序，到达顶层/底层不再移动。选中组合时包含子图层，沿用现有锁定校验；`front/back` 仍表示直接置顶/置底。

装饰使用 `decorationFormat: css/html`，切换格式时同时提交完整 `content`。调色前通过 `read_layers` 读取源码，再用 `edit_layers/update` 更新相应 CSS 变量，保留其他样式和 alpha；不接受装饰的 `color` 字段，避免无效调色返回成功。文字与 SVG 继续使用 `color`。变量颜色支持 HEX（含透明度）、RGB/RGBA、HSL/HSLA、OKLCH 与命名颜色，人工拾色器不是 AI 操作目标，不需要新增界面控制工具。背景自定义 CSS 使用 `background: {type: css, value: 声明文本}`，不支持 HTML 背景。

`config.ts` 的 `VISUAL_CONTENT_GUIDE` 记录当前能力和约束，默认系统提示词包含该说明。`toRequestConfig` 在实际请求中为缺少说明的自定义提示词追加一次，不覆盖已保存的用户文本；实际请求和上下文预算使用同一个合成提示词。

## 安全边界

- 浏览器 AI 配置存入独立 IndexedDB 数据库 coverflow-ai：settings 保存剔除 Key 的配置，encryption-key 保存不可导出的 AES-GCM 256 位 CryptoKey，endpoint-secrets 保存各接入点的随机 12 字节 IV 和密文。文件模式仅主密钥仍留在本机 encryption-key，其余配置和密文在 chat/config.json。接入点 ID 作为附加认证数据，避免密文被换到其他连接。
- 配置与密文同一事务提交，保存队列串行化；删除接入点或清空 Key 会清理旧密文。并发生成加密密钥时使用读写事务回读，避免两个页面互相覆盖主密钥。
- 缺失主密钥或解密失败时报错，不生成替代密钥来覆盖数据。该本机方案不防御同源恶意脚本，也不保证浏览器配置文件被整体复制后的安全性；清理站点数据后无法恢复。
- 修改接入地址时清空该接入点的旧密钥，避免将它发送给另一服务。
- HTTP 仅允许回环地址；其余端点必须 HTTPS。端点拒绝 URL 内的用户名、密码、查询参数与片段。
- 项目删除由用户确认。拒绝后立即结束本轮，不让模型自动再次申请删除。
- AI 执行期间主工作区 inert，同时拦截全局编辑快捷键和粘贴。停止按钮仍可使用。
- SVG 通过 DOMParser 检查结构，拒绝脚本、事件、foreignObject、嵌入样式、动画和外部引用。装饰 CSS/HTML 与人工编辑共用清洗校验：CSS 为单元素外观声明（6000 字符、24 条声明含变量），HTML 为静态标记（24000 字符、300 个元素），支持局部 `<style>` 和行内样式。禁止脚本、事件、外部资源、CSS at-rule、动画/transition、fixed/sticky、pointer-events 和视口单位；HTML 只允许嵌入位图。选择器隔离仅在渲染时生成，不写入源码。背景 CSS 仅支持背景属性和变量，最多 6000 字符。
- 图片只允许 HTTP(S) 或 PNG/JPEG/WebP/GIF 数据 URL。数据 URL 在 AI 读取结果中隐藏；云端 URL 仍可能由浏览器加载。
- 所有服务请求由用户指定的端点直接处理，必须考虑服务商的数据合规和 CORS。项目内容不属于可信指令。
- 请求超时 120 秒，最多 12 轮、每轮最多 30 个工具调用。SDK 自动重试关闭，保留用户中止信号。网络断流或输出截断时不执行不完整调用；工具中断或用户拒绝时配对剩余调用的错误结果，不自动重试已完成操作。

## 验证与扩展

`npm run test:ai` 使用 Node 原生测试、TypeScript 类型剥离（Node 22.18+）与 fake-indexeddb。覆盖图层几何、组关系、锁定、字段安全、过期 ID、项目生命周期、删除确认、Responses 事件、工具历史回传、配置校验、多模型选择、思考参数、用量汇总、中止、浮窗边界、加密往返、密文篡改、会话隔离及文件路径限制。`npm run typecheck:ai` 对 AI 目录执行严格类型检查。前端打包使用 `npm run build`；原生存储命令使用 `cargo check --manifest-path src-tauri/Cargo.toml`。全仓类型检查仍存在既有翻译字段、文件系统 API 声明和 Vite 插件版本诊断，未在本次功能中扩展修复范围。

新增工具时先补 definition 与参数校验，再实现 executor 或 workspace 行为，并添加相邻测试。模型通信不要直接导入 App 或操作 DOM。图片生成、资产库搜索与导出工具不在当前实现范围内，可按需要另增服务和工具。