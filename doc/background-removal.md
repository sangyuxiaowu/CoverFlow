# 本地抠图

独立于聊天、生图 API 和项目存储的浏览器抠图模块。图片只在本地 Worker 中推理，不上传服务端。

## 入口

- AI 配置中心 > 抠图：管理模型、计算设备、运行时及缓存。
- 图片图层属性 > 抠图：保留位置、大小、来源和描述。禁用时直接显示原因；缺少运行时会显示设置路径。
- “保留原图”默认勾选：成功后隐藏原图，创建相同位置的已抠图副本，并选中副本；取消勾选则原地替换。整次变更作为一次撤销，失败或取消不复制、不隐藏原图。
- 图片图层的 `backgroundRemoved` 标记随项目保存、复制和普通编辑保留；已处理图片不可再次抠图。替换为新图片时重置标记；旧版已处理但没有标记的图片无法自动识别。
- 模型导入或下载后先实际推理验证，通过后自动激活；失败不覆盖旧模型。
- 资源和设备设置即时保存到独立 IndexedDB，不依赖 AI 配置的保存按钮。

## AI 工具

`remove_background` 固定注册在通用工具定义中，不受视觉能力、生图开关或本地资源安装状态影响，不动态注入或移除函数定义。

参数：`projectId` 和 `layerId` 必填；`modelId` 可选 `u2netp`（默认，内置轻量、速度优先）或 `birefnet`（高质量候选，适合复杂边缘，要求提前安装且消耗更多内存）；`keepOriginal` 默认 true；`device` 可选 auto（默认）、webgpu 或 wasm。这些参数只影响本次调用，不更改用户设置。

调用时先检查目标及模型。缺少大模型不自动下载，通过 `MODEL_NOT_READY` 结果提示用户导入。目标和模型就绪但缺少运行时，会自动尝试下载约 24 MB 并缓存，下载等待最多 180 秒，用户可停止操作。成功返回结果图层 ID、模型、实际计算设备及是否下载运行时。

失败返回 `success:false`、`code`、`stage`、原始错误信息及可用的错误原因，模型可以直接据此反馈。包括校验、模型、运行时、下载、图片读取、推理、应用结果和保存失败；失败工具在聊天中标记为错误。若保存失败，返回可能已应用的结果图层 ID，须先读取上下文，不可盲目重复抠图。取消沿用现有对话中断原因处理。

## 分发

U2NetP 放在 `public/models/u2netp.onnx`，约 4.57 MB，随 Web/PWA/Tauri 构建分发。PWA 根据文件内容生成缓存版本；更新文件后重新构建即可。上游 Apache-2.0 许可证与模型一起分发。

本地 BiRefNet 使用 `birefnet-lite-512`，不打包模型，默认 FP16 下载约 98.48 MB。也可导入同仓库约 191.88 MB 的 FP32 版本；两者均为固定 512×512 输入。支持本地导入，默认从 ModelScope 镜像直接下载，不经过应用服务器。旧版 1024 模型及曾导入到同一入口的其他模型不会复用为 Lite 512，需在 BiRefNet 入口重新导入；原版 BiRefNet 的 API 接入不在本地模块中实现。

- FP16：https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model_fp16.onnx?view=false
- FP32：https://www.modelscope.cn/models/sangsq/birefnet-lite-512/resolve/master/model.onnx?view=false

两种精度共用一张 `BiRefNet Lite 512` 卡片，分别提供“下载 FP16”和“下载 FP32”按钮，并显示各自下载体积。安装后卡片和模型选择框按实际文件显示体积，不用默认 FP16 名称标注 FP32；导入文件不通过名称或精确大小猜测精度。一次保留一个已验证版本，下载及推理验证成功后才替换原文件。“查看源权重”打开模型仓库，不固定下载某个精度。

ONNX Runtime Web 1.23.2 不进入主构建，首次在设置页从 jsDelivr 下载约 24 MB，之后保存在 IndexedDB。也可从设置页列出的链接下载以下三个同版本文件，选中后一起导入：

- `ort.webgpu.bundle.min.mjs`
- `ort-wasm-simd-threaded.jsep.mjs`
- `ort-wasm-simd-threaded.jsep.wasm`

运行时包含可执行 JavaScript，只应导入可信来源的文件。JS、加载器和 WASM 必须来自同一 ORT 版本。大模型和运行时也可放在网盘独立分发；网盘分享页不是可直接 fetch 的资源地址。

## 模型约定

`models.ts` 的 size 仅作下载体积展示，不作为版本锁。导入不校验固定 SHA-256 或精确文件大小；只做大小上限、明显 HTML/JSON/LFS 指针检查，然后通过实际推理验证接口。

- U2NetP：RGB 320×320，按最大 RGB 值缩放，再做 ImageNet 归一化；使用第一个输出并做 min-max 归一化。
- BiRefNet Lite 512：RGB 直接缩放到 512×512，除以 255 后做 ImageNet 归一化；第一个输出为 logits，使用 sigmoid，不叠加额外阈值或柔边。
- 支持单个 NCHW float32/float16 输入及单通道 float32/float16 输出。不是任意 ONNX 模型的通用加载器；外置权重文件不支持。
- 输出保留原图像素尺寸，将遮罩乘入原有 alpha，编码为 PNG；不裁切主体。

默认自动尝试 WebGPU，初始化或推理失败后重建 CPU/WASM 会话。CPU 单线程不要求 COOP/COEP；推理在 Worker 内执行。取消会终止 Worker；10 分钟超时。大模型的 FP16 算子、显存需求和速度依赖设备，CPU 回退不保证所有模型都能运行。图片上限 40 MP，模型上限 1 GB。

## 文件职责

- `storage.ts` / `resources.ts`：独立二进制缓存、直连下载、离线导入。
- `index.ts` / `inference.worker.ts`：模型安装验证、推理、取消和设备回退。
- `processing.ts`：纯像素预处理、遮罩及 alpha 合成。
- 两个 React 组件：设置入口与图层操作入口。

验证：`bun run test src/features/background-removal`，完整构建：`bun run build`。

模型来源：

- https://www.modelscope.cn/models/budaoshou/U2NetP-ONNX
- https://huggingface.co/JONNYVERSE/birefnet-lite-512
- https://www.modelscope.cn/models/sangsq/birefnet-lite-512
- https://github.com/xuebinqin/U-2-Net
- https://github.com/ZhengPeng7/BiRefNet

运行时来源及许可： https://github.com/microsoft/onnxruntime （MIT）。