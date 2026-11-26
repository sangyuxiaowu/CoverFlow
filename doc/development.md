# 开发与项目结构

## 本地开发

前置要求：安装 Bun；Node.js 需为 20.19+（20.x）或 22.12+，以满足 Vite 7 的运行要求。

```bash
bun install
bun run dev
```

构建与预览：

```bash
bun run build
bun run preview
```

测试与类型检查：

```bash
bun run test
bun run typecheck
```

## 技术栈与职责

- React 19、TypeScript、Vite 7、Tauri 2、Tailwind CSS 4
- html-to-image 用于导出；JSZip 用于多页图片打包；pptxgenjs 按需加载，用于生成图片型 PPTX
- AI 浮窗、配置界面、SKILL、生图协议、浏览器加密存储和工具轮次调度由 SangAIKit 提供；CoverFlow 保留原有数据库与备份格式、文件存储适配器、专用工具和画布操作。详见 [AI 模块说明](ai-architecture.md)

## 目录结构

```text
.
├─ src/                # 前端应用源码，测试与对应模块放在一起
│  ├─ assets/          # 随前端打包的图片与 Logo
│  ├─ components/      # UI 组件与面板
│  ├─ features/        # AI 工作区与宿主接入
│  ├─ hooks/           # 业务 Hooks
│  ├─ views/           # 落地页、项目浏览区与预览条目
│  ├─ storage/         # 存储适配器
│  ├─ utils/           # 工具函数
│  ├─ App.tsx          # 顶层视图切换与编辑状态
│  ├─ index.tsx        # React 挂载入口
│  ├─ index.css        # 全局样式
│  ├─ constants.ts     # 常量与默认配置
│  ├─ types.ts         # 类型定义
│  ├─ translations.ts  # 文案与多语言
│  └─ vite-env.d.ts    # Vite 与浏览器 API 类型声明
├─ src-tauri/          # Tauri 原生端
├─ scripts/            # 构建/同步脚本
├─ doc/                # 文档与素材
├─ public/             # PWA 资源与静态文件
├─ index.html          # Vite HTML 入口
├─ vite.config.ts      # 开发与打包配置
└─ tsconfig.json       # TypeScript 配置
```

应用源码统一位于 `src/`，`@/` 别名指向该目录。`public/` 中保留按 URL 直接访问的图标和模型文件；构建脚本、配置、文档与 Tauri 原生工程不放入前端源码目录。

## 项目存储实现

- 浏览器存储使用 IndexedDB 保存项目；LocalStorage 仅保存语言、视图偏好和部分预设等设置。
- `.cfjx` 采用 ZIP，包含项目索引、按页 ID 拆分的页面 JSON、去重后的图片和可选的页面 WebP 预览；活动页和图层选区不保存。
- IndexedDB 项目按页和去重后的图片二进制保存；编辑和预览按需使用二进制缓存，撤销历史、AI 检查点及异步保存会持有所需图片。
- 文件夹根目录的 `project.json` 是可重建的项目索引，`preview/` 保存与项目文件同名的 WebP 封面；首页核对 `data/` 文件属性，只读取新增或变化的项目。项目正文以 `data/` 内的文件为准。

旧项目处理见 [旧项目兼容与转换](legacy-projects.md)。