# AI-LIS 第一版原型需求

这是一个 AI-LIS 实验室信息管理系统原型，面向单实验室 / 单院区。

第一版先做静态前端原型，不接入真实医院系统，不使用真实患者信息，不需要后端和数据库。

V1 核心展示三件事：

1. 智能预审 / 自动放行
2. 危急值自动闭环
3. 内部智能助手

AI 不替代最终医疗责任人，只做筛选、解释、催办、排序。

第一版页面包括：

- 审核技师工作台
- 样本流转概览
- AI 预审队列
- AI 判定卡片
- 危急值中心
- 内部智能助手

AI 判定卡片必须采用：

1. 结论
2. 命中规则
3. 建议动作

技术要求：

- 使用 HTML、CSS、JavaScript
- 代码先写在 index.html
- 所有数据使用模拟数据
- 保持 GitHub Pages 可部署

## Windows 桌面端运行与打包说明

本项目在保留现有 GitHub Pages 静态网页版本的基础上，新增 Electron Windows 桌面端演示版能力。桌面版与网页版共用 `index.html` 作为入口，不接入后端服务，不接入数据库，当前仍然使用模拟数据，请勿录入或使用真实患者信息。

### 安装依赖

```bash
npm install
```

### 本地运行桌面版

```bash
npm start
```

Electron 将加载本地 `index.html`，以桌面窗口形式运行 TERRY-LIS 实验室信息管理系统原型。

### 打包 Windows 版本

```bash
npm run build
```

打包工具使用 `electron-builder`，应用名称为 `TERRY-LIS`，Windows 安装包文件名中会包含 `TERRY-LIS`。

### 打包产物位置

```text
dist/
```

### 数据与部署说明

- 当前桌面版仍然是静态演示原型，所有数据均为模拟数据。
- 桌面版不接入后端服务，不接入数据库。
- 现有 GitHub Pages 网页版本继续使用同一个 `index.html`，无需通过 Electron 即可作为静态页面部署。
