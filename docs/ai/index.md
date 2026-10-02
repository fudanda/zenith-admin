# AI 辅助开发

ArcBase 在仓库内维护面向 AI 编程工具的协作资产，目标是让 AI 先理解项目边界，再按项目规范修改代码。

## 两件资产

| 资产 | 位置 | 职责 |
| --- | --- | --- |
| [AGENTS.md](./agents) | 仓库根目录 `AGENTS.md` | 项目导航：系统边界、目录职责、依赖方向、运行时链路与常用命令 |
| [ArcBase Skill](./skills) | `.agents/skills/arcbase/` | 开发流程与规范：CRUD、模块修改、异步任务、通知、发版、排错与硬约束 |

## 单一事实来源

- `AGENTS.md` 只放稳定架构事实和入口指针。
- 约束正文只放在 `.agents/skills/arcbase/references/constraints.md` 与 `constraints-frontend.md`。
- 代码模板与流程说明按主题拆到 skill reference 文件。
- 文档站只解释使用方式，不复制完整规则。

## 工作方式

```text
会话开始
    ↓
读取 AGENTS.md（项目结构、命令、架构、文档入口）
    ↓
涉及代码改动时读取 constraints.md 或 constraints-frontend.md
    ↓
按任务类型进入 ArcBase Skill reference
    ├─ CRUD 开发：crud-intake → crud-backend → query-cache → crud-frontend → seed-config → crud-mock
    ├─ 修改模块：module-modification
    ├─ 异步任务：async-tasks
    ├─ 通知事件：notifications
    ├─ 发版：release
    └─ 排错：troubleshooting
```

## 适用范围

这组资产服务于本仓库开发，不是运行时 AI 功能。运行时 AI 功能区（模型、对话、智能体、RAG、评测、Studio）见 [AI 能力](/ai-platform/)。

## 深入阅读

- [AGENTS.md](./agents)
- [ArcBase Skill](./skills)
- [项目结构](/guide/project-structure)
- [本地开发](/guide/development)
