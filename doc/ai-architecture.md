# CoverFlow AI 模块

## 目录职责

```text
src/features/ai/
  types.ts                    协议与工作区桥接契约
  domain/layerOperations.ts   纯图层规则、分组几何与批量操作
  domain/floatingGeometry.ts  浮窗位置与尺寸边界
  tools/definitions.ts        模型可见的 JSON Schema
  tools/requests.ts           动作契约、派生联合类型与请求解析
  tools/validation.ts         运行时白名单、数值范围及内容安全校验
  tools/execute.ts            工具分发与当前项目 ID 校验
  tools/imageTools.ts         生图发现、单图参考与图片资源放置
  services/config.ts          多接入点、多模型、思考参数及配置校验
  services/configStore.ts     IndexedDB 配置与 AES-GCM 加密密钥存储
  services/encryptionKeys.ts  一次性主密钥备份、口令保护及不可导出导入
  services/chatStore.ts       浏览器/文件双模式配置、会话与界面状态
  services/chatFileAccess.ts  File System Access 与 Tauri 文件适配
  services/conversation.ts    OpenAI SDK Responses 事件、原生历史、工具循环
  image-generation/index.ts   生图统一入口、校验、超时及请求调度
  image-generation/types.ts   生图配置、能力及适配器契约
  image-generation/models.ts  模型预设、适配器注册与能力查询
  image-generation/adapters/  Kolors / Agnes / GPT-Image 协议实现
  image-generation/results.ts 结果下载、安全校验与原始图片归一化
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
- 模型配置异步加载或保存期间禁止发送与切换。普通读取失败展示可重试错误；凭据解密失败单独进入恢复状态，保留聊天与设置入口，禁止普通配置保存覆盖旧密文。

## 单轮调用限制

- AI 配置中心最后的“其他设置”页包含密钥管理及单轮调用限制：`maxToolRounds`（工具调用轮次上限，默认 24）和 `maxImageFailures`（生图累计失败上限，默认 3），均为正整数，可恢复默认。设置随现有 ChatStore 在浏览器或文件模式保存，并在下一轮对话生效。
- 工具轮次按一次模型响应及其工具批次计数，不是逐个工具计数；每个响应仍最多接受 30 个工具调用。达到轮次上限保留已完成操作及配对历史，并可继续。
- 生图失败在单次 `runConversation` 内跨模型、跨批次累计，成功不清零。默认第 3 次失败后拦截该轮后续生图，不再向生图服务发请求；普通生图错误仅返回 `{ error: 具体原因 }`，不附加失败预算、计费警告或重试指令。达到上限时仅返回上限错误，放置失败保留已生成图片 ID 及失败原因。失败预算不是强制重试次数，SDK 和底层生图请求仍不自动重发。
- 停止或关闭面板仍中止整轮，不消耗生图失败预算；新一轮重新计数。已生成并保存的图片应复用，不因放置失败重复生成。失败及超时的服务商请求可能已经计费，提高上限可能增加费用。

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

工具采用分层 JSON Schema 描述：函数 `description` 只说明用途与整体行为；字段含义、单位、默认值、适用操作及内容限制写在对应参数的 `description` 中，包括嵌套属性、数组元素和联合类型分支。可执行约束用 `enum`、`required`、`minimum/maximum`、`minItems/maxItems` 等表达，执行器仍负责最终校验。创建图层统一使用 `add_layer`，要求 `projectId`、`type` 和 `properties`；`type` 为 `text/image/svg/decoration`，必须提供对应的 `properties.<type>.content`，禁止提供其他类型的属性组。通用 `layerInfo` 与四类专属属性在同一个参数 Schema 中完整内联，不使用 `$defs/$ref`，以兼容不支持引用的远端。各组内容的格式与安全限制分别写在字段说明中。`update_layers.properties` 保持开放对象，不重复枚举字段，由创建/读取函数说明属性，运行时白名单负责校验；它仍是部分字段补丁，组内 `content` 可省略。

图层函数与内部操作的映射、请求字段规则集中在 `tools/requests.ts`，独立函数的输入经白名单和必填校验后转换为内部可辨识动作联合类型，复用现有图层操作内核。对外不再注册或执行四个 `add_*_layer` 入口及 `edit_layers`，也不接受图层函数的 `action` 字段。项目新建和搜索分别由 `create_project`、`search_projects` 提供，不再作为 `manage_projects` 动作。为兼容自定义模型端点，对外保留对象 Schema 与 `strict:false`，不发送顶层 `oneOf`、`$defs/$ref` 或 OpenAPI `discriminator`。条件约束由运行时执行，不依赖模型遵守说明。所有请求先校验再产生存储或界面副作用。

更新、组织和排列图层的函数均要求 `projectId` 和非空 `layerIds`；仅 `update_layers` 接受且必须提供非空 `properties`，它只更新属性，不负责编组、删除或排序，禁止提交 `zIndex`。仅 `group_layers` 接受顶层可选 `name`；`align_layers`、`distribute_layers` 必须提供各自允许的 `mode`；`reorder_layers` 必须提供 `position`。创建图层默认置顶，不接受 `zIndex`，后续排序统一使用 `reorder_layers`。`create_project` 的 `title/width/height` 可选；`search_projects` 的 `query/page/pageSize` 可选；`manage_projects` 只接受 `open/rename/duplicate/delete/save`，并要求 `projectId`。`rename.title` 必填，`duplicate.title` 可选，其余管理动作禁止。跨操作字段与未知字段均报错，不忽略。

图层工具读写采用一致的属性分组：`name` 与身份字段 `id/type/parentId` 在外层，通用属性统一位于 `layerInfo`（含位置、尺寸、旋转、层级、透明度、显隐、锁定和比例锁定），类型专属属性分别位于 `text/image/svg/decoration`；组合子图层位于 `group.children`。新增时不允许设置 `zIndex`，更新时层级通过 `reorder_layers` 调整。内容位于对应类型分组的 `content`，不提供外层 `content`。例如新增文字调用 `add_layer`，传入 `type: "text"` 及 `properties: {name: "标题", layerInfo: {x: 52}, text: {content: "标题", fontSize: 78, color: "#fff6ea"}}`；更新时 `properties.name` 单独设置名称，其他通用属性通过 `properties.layerInfo`，类型专属字段仍放对应分组。不接受扁平属性或与目标类型不符的分组；混合类型批量更新在提交前完整校验，不会部分生效。项目存储仍使用内部扁平 Layer，工具边界负责转换，不迁移历史项目。

`read_layers`、`get_selected_layers` 和 `get_context` 将 `name` 与身份字段 `id/type/parentId` 放在外层；其余通用属性位于 `layerInfo`，类型专属属性位于各自分组。组合的子图层列表位于 `group.children`，组合不返回无意义的空内容。图片只读抠图标记位于 `image.backgroundRemoved`，选区图片的来源与预览状态位于 `image.imageInfo`；这些只读字段不可作为更新属性回传。`read_layers` 的内嵌图片占位位于 `image.content`；`get_selected_layers` 仍省略图片内容，视觉模型的图片预览机制不变。

| 工具 | 功能 |
| --- | --- |
| get_context | 当前项目、画布、背景、选区及图层元数据 |
| create_project | 新建并打开项目 |
| search_projects | 按名称搜索项目并返回分页结果 |
| manage_projects | open/rename/duplicate/delete/save |
| read_layers | 按 ID 或名称/内容关键词读取图层 |
| add_layer | 按 type 添加文字、已有图片、SVG 或 CSS/HTML 装饰图层 |
| update_layers | 仅更新图层属性，例如移动位置或修改图片 |
| delete_layers / duplicate_layers | 删除或复制图层 |
| group_layers / ungroup_layers | 编组或拆组 |
| reorder_layers | 按 position 调整堆叠顺序 |
| align_layers / distribute_layers | 按 mode 对齐画布或等间距分布 |
| update_canvas | 画布尺寸及纯色/渐变/图片/自定义 CSS 背景、纹理 |
| list_image_models | 多模型时读取当前启用模型的介绍、版本及参数能力 |
| generate_image | 文生图或单图参考生图，成功后自动添加图层并返回图层 ID |

## 生图配置与调用

- 生图模型在独立 Tab 中管理，`imageModels` 保存内部配置 ID、API 模型 ID、介绍、适配器、尺寸参数、启用状态和 `endpointId`。通过引用已有端点复用 Base URL 与加密 Key，不复制凭据。可覆盖同源的完整请求 URL；跨域须单独配置端点，避免 Key 被发送给未授权域名。
- 默认接口为 `/v1/images/generations`；已有版本路径的 Base URL 不重复拼接 `/v1`。Kolors 使用 `image_size`、`num_inference_steps`、`guidance_scale`，参考图为单个 `image`；返回 `images[0].url`。Agnes 使用 `size`，档位尺寸可配 `ratio`；文生图使用 `return_base64`，参考图使用 `extra_body.image` 单元素数组和 `response_format: b64_json`；解析 `data[0].b64_json` 或 URL。
- GPT-Image 提供 `gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2` 三个可编辑预设，默认不启用，沿用已有端点凭据。文生图向 `/images/generations` 发送 JSON；单图参考向 `/images/edits` 发送 FormData，上传单个 `image`，不发送 mask，不手动设置 Content-Type。同源请求 URL 覆盖若以 `/images/generations` 或 `/images/edits` 结尾，会按模式切换尾部路径；其他自定义路径不能推导参考图接口。
- GPT-Image 固定 `output_format: png`，不发送 `response_format`，支持 `size`、`quality`、`n`。尺寸为 WIDTHxHEIGHT，两边必须是 16 的倍数、不超过 3840，比例为 1:3–3:1，总像素为 655360–8294400；2560x1440 为实验尺寸。Sunburst/Flare 质量支持 low/medium/high/xhigh/max/auto；GPT-Image-2 支持 low/medium/high。默认 1024x1024、high、1 张；客户端数量限制 1–10，实际尺寸、质量和数量仍取决于接入服务，模型 ID 可按服务提供值修改。其他未识别 GPT-Image ID 保守使用 low/medium/high。
- 统一入口 `generateImages` 返回 Blob 列表，解析 `data` 中全部 `b64_json` 或 URL 结果，不只读取第一张。工具先保存全部图片，再逐张居中放置；单图返回 layerId/imageId，多图返回 `images` 中的各图层与图片 ID。放置失败保留已经保存的全部图片，禁止自动重生成。URL 返回方式还要求上游 CDN 支持跨域读取，下载不携带 API Key。
- 通用文生图、参考图提示词指导集中在 `config.ts` 的 `DEFAULT_IMAGE_TOOL_PROMPT` 中，实际请求通过全局生图提示词提供一次，不在各模型或列表中重复。模型特有的提示词要求直接写在模型介绍 `description` 中，不再提供独立的文生图/参考图说明设置。仅启用一个模型时，`generate_image` 直接绑定该模型：省略 `modelConfigId`，参数说明中保留模型介绍和能力，Kolors 不提供 ratio。多个模型时额外注册 `list_image_models`，仅由列表返回各自介绍、版本和能力。已保存的自定义全局生图提示词不被默认内容覆盖，不迁移已删除的每模型说明字段。
- 生图配置还保存可编辑的 `version` 和 `releasedAt`（YYYY-MM-DD）。预设中的日期来自已提供的模型资料，未知时留空；不从介绍文本自动解析，也不编造发布日期。多模型列表返回版本、发布日期和有效 `timeoutSeconds`，未知版本/日期为 null；单模型工具说明包含相同信息，供模型结合能力作选择参考。这些字段只属于本地配置与工具上下文，不作为图像 API 请求参数。
- 新生图模型、会话图片和生成图层沿用应用的 9 位短 ID。已有模型的长 ID 不重写存储，仅映射为稳定的短工具 ID；配置校验拒绝短 ID 冲突。单模型调用绑定请求开始时的模型，期间禁用或替换模型不会静默切换到另一个。
- 生图预设各自配置默认超时：Kolors/Agnes 为 180 秒，GPT-Image-2.5-Flare 为 300 秒，GPT-Image-2.5-Sunburst/GPT-Image-2 为 600 秒。这些是可调整的客户端等待策略，不是服务商延迟保证。每个模型实例可独立设置 60–600 秒，并恢复对应预设值；已设置的值不随预设更新被覆盖。未显式设置时按适配器与 API 模型 ID 查找预设，未知自定义模型回退到 180 秒。设置页、模型发现和实际请求共用同一超时解析函数。工具保持 running 并等待完整响应，不在 60 秒时提前结束，也不强制延迟已完成的响应。用户停止会中止请求；超时、下载、存储或响应失败受单轮累计失败预算约束。客户端中止不保证服务商停止计算或免除费用。
- 生图失败预算仅作用于一次 `runConversation`，不跨用户消息保留；新消息可明确授权再次尝试。界面“重试”续接已有进度时，会向实际模型历史追加用户授权，要求保留成功操作及已保存图片。达到失败上限由执行器硬性拦截，不依赖 LLM 自觉停止。
- 整轮中止与重试授权分开处理。停止、关闭面板、切换聊天存储、卸载或重新加载助手分别通过 `ConversationAbortError` 标记为 `user_stop`、`panel_closed`、`storage_changed`、`assistant_disposed`。工具结果及持久化历史保留 `abortSource` 和 `reason`；未标记的外部中止记为 `unknown`，不推断用户操作。界面显示对应的中止原因，不再统一声称缺少重试批准。旧历史没有中止来源时无法事后恢复原因；这些变更不自动修复尚未定位的意外中止。
- 无可用模型时不注册生图工具；模型列表只暴露启用且配置有效的条目。执行前重新检查最新启用状态，旧对话中的模型 ID 不能绕过禁用。配置、Key、请求地址不会作为工具结果返回。
- 单图参考仅接受当前会话图片资源 ID，或带当前项目 ID 的图片图层 ID。两者互斥，禁止多图参数及未知字段。上传参考图和预览保留现有 WebP 处理；生成结果按接口返回的 PNG/JPEG/WebP 原始字节、格式和分辨率保存，不重新编码，限制为 25 MB、6400 万像素。文件模式使用对应的 .png/.jpg/.webp 扩展名，读取时恢复正确 MIME，清理覆盖全部三种格式。
- 生成前必须提供当前 `projectId`；生成成功后保存会话图片，并通过实时工作区桥接自动添加等比适配、居中的 image 图层，返回 layerId、imageId 和位置尺寸，不回传 Base64。不再提供 `apply_image`；作为背景时使用 `reorder_layers` 置底，再用 `update_layers` 调整和锁定。图片嵌入项目，不依赖会话存续，也不放宽文本工具的长度限制。等待期间切换项目或放置失败时，保留已保存图片并明确报告失败，禁止自动重新生成。
- 所有请求直接由浏览器发送，生图接口及图片下载地址须允许 CORS。当前启停是本地配置，不是服务端管理员权限控制。

图层更新支持位置、宽高、旋转、透明度、锁定、显隐、比例锁定、名称、内容、文字颜色/字体/字号/字重/对齐/书写方向/渐变/阴影。层级统一通过排序函数调整。结构字段 id/type/parentId/children 不允许直接修改，分组操作负责维护关系。不允许嵌套分组。组合图层变换传递到子图层，子图层变化会刷新组合边界。App 手动图层更新和 AI 更新共用 updateProjectLayer，保持变换规则一致。

层级微调使用 `reorder_layers` 的 `position: forward/backward`，分别上移/下移一层，同时提供 `projectId` 和 `layerIds`，不接受 `properties/mode/name/action`。按实际堆叠顺序跨过相邻的一个未选中图层，不是简单增减 `zIndex`；多选保持相对顺序，到达顶层/底层不再移动。选中组合时包含子图层，沿用现有锁定校验；`position: front/back` 表示直接置顶/置底。

装饰只通过 `decoration.content` 读写，CSS/HTML 格式由内容自动识别，不保存或接受格式字段。调色前通过 `read_layers` 读取源码，再用 `update_layers` 更新相应 CSS 变量，保留其他样式和 alpha；装饰没有主色字段，避免无效调色返回成功。文字与 SVG 分别使用 `text.color` 和 `svg.color`。变量颜色支持 HEX（含透明度）、RGB/RGBA、HSL/HSLA、OKLCH 与命名颜色，人工拾色器不是 AI 操作目标，不需要新增界面控制工具。背景自定义 CSS 使用 `background: {type: css, value: 声明文本}`，不支持 HTML 背景。

## 安全边界

- 浏览器 AI 配置存入独立 IndexedDB 数据库 coverflow-ai：settings 保存剔除 Key 的配置，encryption-key 保存不可导出的 AES-GCM 256 位 CryptoKey，endpoint-secrets 保存各接入点的随机 12 字节 IV 和密文。文件模式仅主密钥仍留在本机 encryption-key，其余配置和密文在 chat/config.json。接入点 ID 作为附加认证数据，避免密文被换到其他连接。
- 配置与密文同一事务提交，保存队列串行化；删除接入点或清空 Key 会清理旧密文。首次建钥在读写事务中回读并拒绝覆盖已有主密钥。
- 首次打开设置时，未建钥的客户端自动进入“其他设置”，由用户选择创建或导入，不自动生成替代密钥。创建后仅在当前步骤暂存 32 字节随机密钥，提供一次备份机会；完成、明确跳过或卸载组件时擦除临时字节，本机仅保留不可导出 CryptoKey。已有不可导出密钥不能补导出；当前密钥可用时，用户可显式换钥，自动解密已保存的 API Key 并使用新密钥重新加密，无需手工重填。
- 备份文件格式 `coverflow-encryption-key` v1，口令至少 12 位；PBKDF2-SHA256（600,000 次、随机 16 字节盐）派生 AES-256-GCM 包装密钥，使用随机 12 字节 IV 和固定格式认证数据。导入严格校验版本、派生参数和长度，错误口令或篡改拒绝解密。备份与口令应分开保管，不随聊天目录分享；跳过备份后若本机数据丢失，只能重新填写 API Key。浏览器只能确认已发起下载，用户需确认文件保存成功。
- 导入先验证当前目录或浏览器配置的密文，再替换本机主密钥；现有浏览器凭据可解密时重新加密保留，无法保留则拒绝导入并要求显式重置。其他使用旧主密钥的文件目录仍需要其对应备份，不会被自动重写。Web 与桌面端导入同一备份后可以读写同一目录的加密凭据。
- 重新生成必须确认，区分正常换钥与故障重置：当前密钥可用时保留当前目录及本机浏览器存储中的 API Key，仅重新加密；无法解密时才允许明确确认清空并重新填写 API Key。执行前重新校验状态，不将失败的正常换钥自动降级为清空。文件换钥先写新密文，再提交本机密钥；提交失败时尝试恢复原文件。模型、提示词、聊天和图片保持不变，新密钥仍提供一次性备份。共享目录的其他客户端需要导入新密钥；其他未重写的目录仍需旧密钥，旧备份不能解锁已换钥后的密文。该本机方案不防御同源恶意脚本，也不保证设备失陷或浏览器配置文件整体复制后的安全性。
- 修改接入地址时清空该接入点的旧密钥，避免将它发送给另一服务。
- HTTP 仅允许回环地址；其余端点必须 HTTPS。端点拒绝 URL 内的用户名、密码、查询参数与片段。
- 项目删除由用户确认。拒绝后立即结束本轮，不让模型自动再次申请删除。
- AI 执行期间主工作区 inert，同时拦截全局编辑快捷键和粘贴。停止按钮仍可使用。
- SVG 通过 DOMParser 检查结构，拒绝脚本、事件、foreignObject、嵌入样式、动画和外部引用。装饰 CSS/HTML 与人工编辑共用清洗校验：CSS 为单元素外观声明（6000 字符、24 条声明含变量），HTML 为静态标记（24000 字符、300 个元素），支持局部 `<style>` 和行内样式。禁止脚本、事件、外部资源、CSS at-rule、动画/transition、fixed/sticky、pointer-events 和视口单位；HTML 只允许嵌入位图。选择器隔离仅在渲染时生成，不写入源码。背景 CSS 仅支持背景属性和变量，最多 6000 字符。
- 图片只允许 HTTP(S) 或 PNG/JPEG/WebP/GIF 数据 URL。数据 URL 在 AI 读取结果中隐藏；云端 URL 仍可能由浏览器加载。
- 所有服务请求由用户指定的端点直接处理，必须考虑服务商的数据合规和 CORS。项目内容不属于可信指令。
- 请求超时 120 秒，工具调用轮次由 `maxToolRounds` 配置（默认 24）、每轮最多 30 个工具调用。SDK 自动重试关闭，保留用户中止信号。网络断流或输出截断时不执行不完整调用；工具中断或用户拒绝时配对剩余调用的错误结果，不自动重试已完成操作。

## 验证与扩展

`bun run test` 使用 Vitest 与 fake-indexeddb。覆盖图层几何、组关系、锁定、字段安全、过期 ID、项目生命周期、删除确认、Responses 事件、工具历史回传、配置校验、多模型选择、思考参数、用量汇总、中止、浮窗边界、加密往返、密文篡改、会话隔离及文件路径限制。生图测试覆盖三个适配器的文生图和单图参考请求、GPT-Image 尺寸/质量/数量校验、多图保存放置、动态 prompt Schema、超过 60 秒等待、取消、禁用重检、凭据隔离、高清资源放置和文件持久化。前端打包使用 `bun run build`；AI 严格检查使用 `bun x tsc --noEmit -p src/features/ai/tsconfig.json`。原生存储命令使用 `cargo check --manifest-path src-tauri/Cargo.toml`。全仓类型检查仍存在既有诊断，未在本次功能中扩展修复范围。

### 扩展生图模型

1. 同协议模型：在 `image-generation/models.ts` 的 `IMAGE_MODEL_PRESETS` 添加预设，填写已有适配器 ID、API 模型 ID、默认尺寸及介绍；如能力不同，在对应适配器中按模型 ID 返回限制。
2. 新协议服务：在 `image-generation/adapters/` 添加实现 `ImageAdapter` 的模块，实现 `capabilities`、`validate`、`buildRequest`、`readResults`，并在 `models.ts` 注册，扩展适配器 ID 类型。
3. 设置页从预设与能力表生成添加选项、尺寸、比例、质量和数量控件；工具发现与单模型 Schema 使用相同能力来源。新增特有参数时扩展统一类型与相应控件，不在工具层复制协议分支。
4. 在已有生图测试中补充文生图/参考图请求、参数边界和响应用例。适配器不直接访问 App、存储或 DOM；凭据授权、超时/取消、安全下载和资源放置继续由统一层负责。

新增工具时先补 definition 与参数校验，再实现 executor 或 workspace 行为，并添加相邻测试。模型通信不要直接导入 App 或操作 DOM。资产库搜索与导出工具不在当前实现范围内，可按需要另增服务和工具。