# 换电脑搭建指南

> 目标：新电脑上从零跑起 PromptBox 开发环境。全程约 15 分钟（不含下载时间）。

## 1. 前置环境

| 组件 | 版本要求 | 说明 |
|------|---------|------|
| Node.js | 22 LTS | 官网装即可，无需单独安装 Yarn |
| Git | 任意近期版本 | clone 用 |
| 代理 | 可访问 GitHub | clone 与 push 都需要 |

## 2. 拉取代码

```bash
git clone https://github.com/Azazelsanx/PromptBox.git
cd PromptBox
```

代理不通时可用镜像前缀：

```bash
git clone https://ghproxy.net/https://github.com/Azazelsanx/PromptBox.git
```

## 3. 安装依赖（重点，别用 npm install）

Yarn 4 随仓库自带（`.yarn/releases/`），**禁止 `npm install`**（会生成 package-lock.json 引发依赖漂移，破坏 lockfile）。

```bash
# Windows PowerShell（sharp 原生构建需走国内镜像）
$env:npm_config_sharp_binary_host="https://npmmirror.com/mirrors/sharp"
$env:npm_config_sharp_libvips_binary_host="https://npmmirror.com/mirrors/sharp-libvips"
node .yarn/releases/yarn-4.9.2.cjs install

# macOS / Linux
npm_config_sharp_binary_host=https://npmmirror.com/mirrors/sharp \
npm_config_sharp_libvips_binary_host=https://npmmirror.com/mirrors/sharp-libvips \
node .yarn/releases/yarn-4.9.2.cjs install
```

若 link 阶段报 `EPERM unlink *.node`：有残留 node/electron 进程占用文件，先杀进程再重试。

## 4. 启动开发环境

```bash
node scripts/dev-server.js
```

启动成功的日志标志（依次出现）：

1. `TypeScript 编译成功完成`
2. `主窗口加载完成，通知当前主题`
3. `收到渲染进程消息: Hello from App.vue!`

开发服务器自动热重载：改 `src/main/**` 触发 tsc 重编译 + Electron 重启；改渲染层走 Vite HMR。

## 5. 迁移应用数据（提示词 / AI 配置）

数据不在仓库里，存于 Electron userData 目录（约 23MB）：

- Windows：`%APPDATA%\ai-gist`
- macOS：`~/Library/Application Support/ai-gist`

两种迁法（二选一）：

1. **应用内导出**（推荐）：旧电脑应用「设置 → 数据管理」导出 JSON → 新电脑导入
2. **整目录拷贝**：旧电脑把 `ai-gist` 文件夹整个拷到新电脑同路径（先关闭应用）

## 6. 验证

```bash
# 类型检查（应零错误）
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit

# 测试套件（807 个用例应全绿）
node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts

# 渲染层构建验证（.vue 改动只有 build 能查出错误）
node node_modules/vite/bin/vite.js build --config config/vite.config.web.js
```

## 常见坑速查

- **依赖装不上 / tsc 起不来** → 一定是用了 npm install；删掉 node_modules 和 package-lock.json，改用 Yarn 4 重装
- **改了 .vue 但 tsc 没报错、运行却白屏** → tsc 不查 .vue，必须跑 vite build 验证
- **"重启"后行为不对** → 看进程创建时间（PowerShell：`Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Select CreationDate`），老进程残留会假启动；杀干净再启
- **git push 连不上** → 检查本机代理端口：`git -c http.proxy=http://127.0.0.1:<端口> push`
