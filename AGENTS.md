# AGENTS.md

## 项目概览

AI 工作台应用，界面风格类似腾讯ima。深色主题，现代简洁的专业工具风格。
完整的全栈应用，包含大模型对话、知识库管理、视频生成、联网搜索、笔记等功能。

### 技术栈
- **前端**: React 18 + TypeScript + Vite + TailwindCSS v4 + Lucide Icons
- **后端**: Express.js + TypeScript
- **数据库**: Supabase (PostgreSQL + pgvector)
- **AI 服务**: coze-coding-dev-sdk (LLM/Embedding/Video/Search)

### 项目结构
```
.
├── client/              # 前端 React 应用
│   ├── src/
│   │   ├── api/         # API 调用封装
│   │   ├── components/  # 通用组件
│   │   ├── pages/       # 页面组件
│   │   ├── types/       # TypeScript 类型定义
│   │   └── App.tsx      # 主应用入口
│   └── index.html
├── server/              # 后端 Express 服务
│   ├── src/
│   │   ├── routes/      # API 路由
│   │   ├── middleware/  # 中间件
│   │   ├── services/    # 业务服务
│   │   ├── storage/     # 数据存储
│   │   │   └── database/ # Supabase 客户端
│   │   ├── schema.ts    # Drizzle ORM schema
│   │   └── index.ts     # 服务入口
│   └── uploads/         # 文件上传目录
├── .coze                # 项目配置
├── package.json         # 根 workspace 配置
├── pnpm-workspace.yaml  # pnpm workspace 配置
├── DESIGN.md            # 设计规范
└── AGENTS.md            # 本文件
```

## 构建和测试命令

### 安装依赖
```bash
pnpm install
```

### 开发模式
```bash
pnpm dev
```
同时启动前端 (5173) 和后端 (5000)，通过 Vite 代理 API 请求。

### 生产构建
```bash
pnpm build
```

### 生产启动
```bash
pnpm start
```
后端服务监听 `DEPLOY_RUN_PORT` 环境变量指定的端口，同时提供前端静态文件。

### Electron 桌面应用

#### 开发模式
```bash
pnpm electron:dev
```
同时启动前后端 + Electron 窗口，自动等待 Vite 就绪后加载。

#### 编译 Electron TS
```bash
pnpm electron:compile
```
将 `electron/` 下的 TypeScript 编译到 `dist-electron/`。

#### 打包桌面端
```bash
# Windows 安装包 (NSIS)
pnpm electron:build:win

# macOS (dmg + zip)
pnpm electron:build:mac

# Linux (AppImage + deb)
pnpm electron:build:linux
```
输出目录：`release/{version}/`

#### Electron 文件结构
```
electron/
├── main.ts          # 主进程（窗口管理、IPC、对话框）
└── preload.ts       # 预加载脚本（contextBridge 暴露安全 API）
tsconfig.electron.json  # Electron TS 编译配置
electron-builder.json   # 打包配置（NSIS 安装程序等）
```

#### 前端可用的 Electron API
通过 `window.electronAPI` 访问：
- `windowMinimize() / windowMaximize() / windowClose()` - 窗口控制
- `isMaximized()` - 是否最大化
- `openFile(options) / openDirectory(options) / saveFile(options)` - 文件对话框
- `getVersion() / getName() / getPath(name)` - 应用信息
- `isElectron() / platform()` - 运行环境检测

## 数据库表设计

### 核心表
| 表名 | 说明 |
|------|------|
| users | 用户表 |
| user_settings | 用户设置 |
| conversations | 对话会话 |
| messages | 对话消息 |
| knowledge_bases | 知识库 |
| documents | 文档 |
| document_chunks | 文档片段 (含 pgvector 向量) |
| knowledge_shares | 知识库分享链接 |
| knowledge_collaborators | 知识库协作者 |
| video_tasks | 视频生成任务 |
| search_history | 搜索历史 |
| notes | 笔记 |

### 向量检索
使用 pgvector 扩展，通过 `match_document_chunks` 函数进行语义搜索。

## API 接口清单

### 认证 `/api/auth`
- POST `/login` - 登录
- POST `/register` - 注册

### 对话 `/api/chat`
- GET `/models` - 获取可用模型列表
- GET `/conversations` - 获取会话列表
- POST `/conversations` - 创建会话
- PATCH `/conversations/:id` - 更新会话
- DELETE `/conversations/:id` - 删除会话
- GET `/conversations/:id/messages` - 获取消息列表
- POST `/stream` - 流式对话 (SSE)
- POST `/send` - 非流式对话
- POST `/save-to-knowledge` - 将对话内容保存到知识库

### 知识库 `/api/knowledge`
- GET `/bases` - 获取知识库列表
- POST `/bases` - 创建知识库
- PATCH `/bases/:id` - 更新知识库
- DELETE `/bases/:id` - 删除知识库
- GET `/bases/:id/documents` - 获取文档列表
- POST `/bases/:id/upload` - 上传文档
- DELETE `/documents/:id` - 删除文档
- POST `/bases/:id/search/stream` - RAG 流式搜索
- POST `/bases/:id/query` - RAG 查询
- GET `/bases/:id/share` - 获取分享信息
- POST `/bases/:id/share` - 创建分享链接
- POST `/bases/:id/collaborators` - 添加协作者
- DELETE `/collaborators/:id` - 移除协作者
- POST `/bases/:id/add-from-url` - 从 URL 添加文档到知识库

### 视频生成 `/api/video`
- GET `/tasks` - 获取任务列表
- GET `/tasks/:id` - 获取任务详情
- POST `/text-to-video` - 文生视频
- POST `/image-to-video` - 图生视频
- DELETE `/tasks/:id` - 删除任务

### 搜索 `/api/search`
- POST `/web` - 网页搜索
- POST `/images` - 图片搜索
- POST `/summarize` - 搜索结果总结
- POST `/summarize/stream` - 流式总结 (SSE)
- POST `/browse` - URL 网页内容解析提取
- GET `/history` - 搜索历史

### 本地大模型 `/api/local-model`
- GET `/health` - 检测 Ollama 服务是否可用（传 `x-ollama-url` header 指定地址）
- GET `/models` - 获取本地已安装模型列表
- POST `/pull` - 下载新模型（ollama pull）
- POST `/stream` - 本地模型流式对话 (SSE，与云端格式一致)

### 笔记 `/api/notes`
- GET `/` - 获取笔记列表（支持搜索、标签过滤）
- GET `/tags` - 获取所有标签
- GET `/:id` - 获取单条笔记
- POST `/` - 创建笔记
- PUT `/:id` - 更新笔记
- DELETE `/:id` - 删除笔记
- POST `/batch-delete` - 批量删除笔记

### 用户 `/api/user`
- GET `/profile` - 获取用户资料
- PUT `/profile` - 更新用户资料
- GET `/settings` - 获取用户设置
- PUT `/settings` - 更新用户设置

## 代码风格指南

- 使用 TypeScript 严格模式
- 组件使用函数式组件 + Hooks
- 深色主题，颜色变量定义在 CSS 变量中
- 接口响应统一使用 `{ data, error }` 格式
- 流式输出使用 SSE (Server-Sent Events) 协议

## 重要说明

- 所有 AI 服务调用必须在后端进行，前端不能直接调用 SDK
- 流式输出默认开启，使用 SSE 协议
- 认证通过请求头 `x-user-id` 和 `x-user-email` 传递
- 文件上传存储在 `server/uploads/` 目录
- 数据库使用 Supabase，通过 `coze-coding-dev-sdk` 的 Supabase 客户端访问
