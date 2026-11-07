# 本地抠图

面向当前页图片图层的本地抠图模块，可从图层属性或 AI 工具调用。图片只在本地 Worker 中推理，不上传服务端；处理结果随页面保存，模型、运行时和设备配置作为独立资源管理。

## 入口

- AI 配置中心 > 抠图：管理模型、计算设备、运行时及缓存。
- 图片图层属性 > 抠图：保留位置、大小、来源和描述。缺少运行时不会禁用按钮；点击后自动下载、校验并缓存运行时，再继续抠图，无需先进入配置中心。已有缓存直接复用，下载显示进度、最多等待 180 秒，可随时取消；失败可重试，不改变图片。模型未安装、图层锁定或已抠图时仍显示禁用原因。
- 图片图层抠图区右上角的模型名可直接选择本图临时模型，只允许选择已安装模型（U2NetP 内置可直接选择），不会修改全局默认。切换图层、替换图片或修改全局默认模型后恢复跟随默认；推理期间禁止切换。此处显示完整注册模型名，包含 MODNet。
- 模型导入或下载后先实际推理验证，通过后自动激活；失败不覆盖旧模型。
- 资源和设备设置即时保存到独立 IndexedDB，不依赖 AI 配置的保存按钮。

## 结果应用

- “保留原图”默认勾选：成功后隐藏原图，创建相同位置的已抠图副本，并选中副本；取消勾选则原地替换。整次变更作为一次内容历史记录，可撤销；失败或取消不复制、不隐藏原图。
- 抠图只处理发起操作时的当前页目标，不批量处理项目全部页面。异步操作保留项目、页面和原图片内容作为目标身份；应用时若不再是原项目或页面，或原图已替换、删除、锁定、已抠图，则不应用结果，也不写入另一页。同页的其他编辑不会被旧快照覆盖。
- 原图及副本保留来源和描述；`backgroundRemoved` 标记随页面保存、页面或项目复制和普通编辑保留，已处理图片不可再次抠图。替换为新图片时重置标记；旧版已处理但没有标记的图片无法自动识别。
- [结果应用函数](../src/features/background-removal/layerResult.ts) 校验图片内容与图层状态，手动入口和 [AI 执行器](../src/features/ai/tools/backgroundRemoval.ts) 在应用前校验项目及页面身份。模型、运行时和设备缓存供各页共用，不因切页重复安装。

## AI 工具

`remove_background` 固定注册在通用工具定义中，不受视觉能力、生图开关或本地资源安装状态影响，不动态注入或移除函数定义。

目标图层必须位于当前页，跨页调用先使用 `manage_pages` 切换；`remove_background` 不接受额外 `pageId` 参数。参数：`projectId` 和 `layerId` 必填；`modelId` 可选 `u2netp`（默认，内置轻量、速度优先）、`birefnet`（BiRefNet Lite 512，适合复杂边缘，要求提前安装且消耗更多内存）或 `modnet`（人像 alpha 抠图，不用于商品或插画，须提前安装）；`keepOriginal` 默认 true；`device` 可选 auto（默认）、webgpu 或 wasm，MODNet 始终使用 CPU/WASM。这些参数只影响本次调用，不更改用户设置，工具不会自动下载外部模型。

调用时先检查目标及模型。缺少大模型不自动下载，通过 `MODEL_NOT_READY` 结果提示用户导入。目标和模型就绪但缺少运行时，会自动尝试下载约 24 MB 并缓存，下载等待最多 180 秒，用户可停止操作。成功返回结果图层 ID、模型、实际计算设备及是否下载运行时。

执行器在运行时准备、读取图片及应用结果前复验目标，按统一的结果应用规则防止过期写入；成功结果包含 `projectId/pageId/sourceLayerId/layerId`。

失败返回 `success:false`、`code`、`stage`、原始错误信息及可用的错误原因，模型可以直接据此反馈。包括校验、模型、运行时、下载、图片读取、推理、应用结果和保存失败；失败工具在聊天中标记为错误。若保存失败，返回可能已应用的结果图层 ID，须先读取上下文，不可盲目重复抠图。取消沿用现有对话中断原因处理。

## 分发

U2NetP 放在 `public/models/u2netp.onnx`，约 4.57 MB，随 Web/PWA/Tauri 构建分发。PWA 根据文件内容生成缓存版本；更新文件后重新构建即可。上游 Apache-2.0 许可证与模型一起分发。

本地 BiRefNet 使用 `birefnet-lite-512`，不打包模型，默认 FP16 下载约 98.48 MB。也可导入同仓库约 191.88 MB 的 FP32 版本；两者均为固定 512×512 输入。支持本地导入，默认从 ModelScope 镜像直接下载，不经过应用服务器。旧版 1024 模型及曾导入到同一入口的其他模型不会复用为 Lite 512，需在 BiRefNet 入口重新导入；原版 BiRefNet 的 API 接入不在本地模块中实现。

- FP16：https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model_fp16.onnx?view=false
- FP32：https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model.onnx?view=false

两种精度共用一张 `BiRefNet Lite 512` 卡片，分别提供“下载 FP16”和“下载 FP32”按钮，并显示各自下载体积。安装后卡片和模型选择框按实际文件显示体积，不用默认 FP16 名称标注 FP32；导入文件不通过名称或精确大小猜测精度。一次保留一个已验证版本，下载及推理验证成功后才替换原文件。“查看源权重”打开模型仓库，不固定下载某个精度。

MODNet 使用 `onnx-community/modnet-webnn`，独立的人像模型卡片与缓存，不打包权重。默认 FP32 约 25.89 MB，可选 FP16 约 12.98 MB；固定使用 CPU/WASM 稳定模式，仓库名中的 `webnn` 不代表必须使用 WebNN。当前 ORT WebGPU 在实际跑步原图上输出错误蒙版：相同权重和输入下，WASM 与 Python CPU 基本一致，而 WebGPU 有显著数值偏差。因此 MODNet 即使在全局选择 WebGPU 时也使用 WASM，其他模型不受影响。已有权重无需重新下载。两种精度共用一张卡片，安装前均须实际推理验证。模型仓库标注 Apache-2.0。

- MODNet FP32：https://www.modelscope.cn/models/onnx-community/modnet-webnn/resolve/master/onnx/model.onnx?view=false
- MODNet FP16：https://www.modelscope.cn/models/onnx-community/modnet-webnn/resolve/master/onnx/model_fp16.onnx?view=false

ONNX Runtime Web 1.23.2 不进入主构建，首次点击图片抠图或 AI 工具调用时会按需从 jsDelivr 下载约 24 MB，之后保存在 IndexedDB。设置页保留手动下载及离线导入入口，可下载以下三个同版本文件，选中后一起导入：

- `ort.webgpu.bundle.min.mjs`
- `ort-wasm-simd-threaded.asyncify.mjs`
- `ort-wasm-simd-threaded.asyncify.wasm`

运行时包含可执行 JavaScript，只应导入可信来源的文件。JS、加载器和 WASM 必须来自同一 ORT 版本。大模型和运行时也可放在网盘独立分发；网盘分享页不是可直接 fetch 的资源地址。

## 模型约定

`models.ts` 的 size 仅作下载体积展示，不作为版本锁。导入不校验固定 SHA-256 或精确文件大小；只做大小上限、明显 HTML/JSON/LFS 指针检查，然后通过实际推理验证接口。

- U2NetP：RGB 320×320，按最大 RGB 值缩放，再做 ImageNet 归一化；使用第一个输出并做 min-max 归一化。
- BiRefNet Lite 512：RGB 直接缩放到 512×512，除以 255 后做 ImageNet 归一化；第一个输出为 logits，使用 sigmoid，不叠加额外阈值或柔边。
- MODNet：将 RGB 直接缩放至已实测的 512×512 方形输入，使用 `(RGB / 255 - 0.5) / 0.5` 归一化；覆盖动态输入维度为 512。输出已经是 alpha，仅截断到 `[0,1]`，不再使用 sigmoid 或 min-max 归一化。
- 支持单个 NCHW float32/float16 输入及单通道 float32/float16 输出。不是任意 ONNX 模型的通用加载器；外置权重文件不支持。
- 输出保留原图像素尺寸，将遮罩乘入原有 alpha，编码为 PNG；不裁切主体。

默认自动尝试 WebGPU，初始化或推理失败后重建 CPU/WASM 会话；MODNet 例外，始终使用 CPU/WASM。CPU 单线程不要求 COOP/COEP；推理在 Worker 内执行。取消会终止 Worker；10 分钟超时。大模型的 FP16 算子、显存需求和速度依赖设备，CPU 回退不保证所有模型都能运行。图片上限 40 MP，模型上限 1 GB。

## 文件职责

- `storage.ts` / `resources.ts`：独立二进制缓存、直连下载、离线导入。
- `index.ts` / `inference.worker.ts`：模型安装验证、推理、取消和设备回退。
- `processing.ts`：纯像素预处理、遮罩及 alpha 合成。
- `layerResult.ts`：目标图片状态校验、结果替换或副本创建及属性保留。
- 两个 React 组件：设置入口与图层操作入口。

验证：`bun run test src/features/background-removal`，完整构建：`bun run build`。

项目页面管理与成品导出见 [使用说明](../README.md)；工作区桥接、页面工具及对话中断机制见 [AI 模块说明](ai-architecture.md)。

模型来源：

- https://www.modelscope.cn/models/budaoshou/U2NetP-ONNX
- https://huggingface.co/JONNYVERSE/birefnet-lite-512
- https://www.modelscope.cn/models/sangsq/birefnet-lite-512
- https://github.com/xuebinqin/U-2-Net
- https://github.com/ZhengPeng7/BiRefNet
- https://www.modelscope.cn/models/onnx-community/modnet-webnn
- https://github.com/ZHKKKe/MODNet

运行时来源及许可： https://github.com/microsoft/onnxruntime （MIT）。