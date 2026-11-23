# 上线准备备忘录（release-memo）

> DeepSeek Harness 插件：项目功能上线前的准备工作备忘录，按环境跟踪上线检查事项。

项目发版前总有一堆事要确认：本地跑通测试、测试环境联调、预发布回归、正式环境发布与观察……这个插件把这些检查项按**环境**和**时间节点**组织起来，避免漏项。

## 界面

左侧边栏点击「上线备忘录」图标，进入专属面板：左栏是检查清单，右栏是时间节点树。

- **左栏**：环境统计卡片 → 环境/状态筛选 + 搜索 → 按环境分组的事项列表
- **右栏**：时间节点树（节点 → 环境 → 事项三层），可逐层折叠；点击节点会联动左栏定位

## 功能

**按环境分类**：本地 / 测试 / 预发布 / 正式四个环境，统计卡片显示各环境完成进度。

**事项字段**：标题、负责人、优先级（P0/P1/P2）、状态（待办/进行中/完成/受阻）、备注。

**时间节点**：独立维护节点列表（名称 + 日期 + 备注）。新增事项时选择节点，截止日期自动跟随；修改节点日期会同步更新关联事项，删除节点则解除关联但保留日期。

**树状导航**：右侧节点树按「节点 → 环境 → 事项」三层展示。点击节点，左栏自动筛选并滚动定位到对应分组。

**跨环境复制**：任一事项可一键复制到其他环境，支持多选目标、选择是否保留原状态。

**新增时环境多选**：勾选多个环境，一次为每个环境各建一条。

**筛选**：环境、状态、关键词组合筛选。

**逾期提示**：截止日期早于今天且未完成的事项红色标注。

**双入口**：
- 侧边栏面板（图形界面）
- 模型工具 `release_memo`，可直接在对话里说「帮我在预发布环境加一条检查项」

## 安装

### 方式一：本地目录安装

1. 克隆仓库到本地：

   ```bash
   git clone https://github.com/<你的用户名>/release-memo.git
   ```

2. 在 DSH 中打开 **Plugins → Add plugin**，选择克隆下来的目录。
3. 刷新页面，左侧边栏出现「上线备忘录」图标。

### 方式二：从 Git 直接安装

如果 DSH 的插件市场支持 Git 源，可直接填入仓库地址安装。

## 配置

默认数据存放于 `~/.dsh/release-memo/checklist.json`。如需自定义位置，在 `cordis.patch.yml` 中给插件行加 `config`：

```yaml
- insert:
    - id: release-memo
      name: '@local/release-memo'
      config:
        dataDir: 'D:\my-data\release-memo'
```

## 架构说明

插件是**双半结构**：

| 半边 | 运行位置 | 职责 |
|---|---|---|
| Host（`index.js` / `store.js`） | DSH 主进程 | 读写本地 JSON、注册 HTTP 路由、提供 agent 工具 |
| Client（`client.js`） | 浏览器页面 | 渲染面板、发送请求 |

**通信方式**：Host 通过 `ctx.connection.fetch.register` 注册同源路由 `/api/release-memo`，Client 用 `fetch()` 调用。

> 注意：静态 `dsh.client` 模块**拿不到** `host.call()` / `styles` 这类内置符号（它们只提供给动态包）。本插件采用的 fetch 桥接与官方 `dsh-context` 插件是同一套方案。

**并发安全**：同一个包可能被二次激活（插件市场热挂载 + profile 安装行），因此写入使用唯一临时文件名 + 原子 rename，读取始终直接从文件读取，两个副本共享同一份数据，不会互相覆盖。

## 数据结构

`checklist.json`：

```json
{
  "version": 2,
  "items": [
    {
      "id": 1,
      "env": "local",
      "title": "本地跑通全量单元测试",
      "owner": "开发",
      "due": "2026-11-26",
      "milestoneId": 1,
      "priority": "P1",
      "status": "done",
      "note": "覆盖率不低于 80%",
      "createdAt": "2026-11-23T06:00:49.625Z",
      "updatedAt": "2026-11-23T06:00:55.806Z"
    }
  ],
  "milestones": [
    {
      "id": 1,
      "name": "需求评审完成",
      "date": "2026-11-26",
      "note": "产研对齐验收标准"
    }
  ]
}
```

首次运行时若文件不存在，会写入覆盖四个环境的示例数据。

## 插件结构

```
release-memo/
├── package.json        # bundle 清单：exports、files、dsh.bundle.patch、dsh.client
├── cordis.patch.yml    # Loader 补丁：插入 release-memo 插件行
├── index.js            # Host 半边：HTTP 路由 + agent 工具
├── store.js            # 数据模型、校验、JSON 持久化
├── client.js           # Client 半边：侧边栏图标 + 面板页
├── locale/
│   ├── zh.json         # 中文标题与描述
│   └── en.json         # 英文标题与描述
└── icon.svg            # 插件图标
```

## 模型工具

`release_memo` 支持以下 action：

| action | 说明 |
|---|---|
| `list` | 列出事项 + 统计 + 全部时间节点，支持 `env` / `status` / `keyword` / `dueFrom` / `dueTo` 筛选 |
| `add` | 新增事项，`item.envs` 可传数组一次建多条 |
| `update` | 修改事项 |
| `remove` | 删除事项 |
| `toggle` | 切换完成状态 |
| `copy` | 复制到其他环境（`targets` 数组） |
| `stats` | 查看统计 |
| `milestones` | 列出时间节点 |
| `milestoneAdd` | 新增时间节点 |
| `milestoneUpdate` | 修改时间节点 |
| `milestoneRemove` | 删除时间节点 |

## License

MIT
