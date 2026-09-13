# AGENTS.md

## 项目概览

AI 工作台应用，界面风格类似腾讯ima。深色主题，现代简洁的专业工具风格。
完整的全栈应用，包含大模型对话、知识库管理、视频生成、联网搜索等功能。

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
- GET `/history` - 搜索历史

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
