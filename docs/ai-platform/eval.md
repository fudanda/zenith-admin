# 模型评测

模型评测页面菜单路径为 `/ai/eval`，基于 **Mastra Datasets / Experiments** 构建：数据集版本化管理，实验异步执行，按打分器聚合平均分并支持逐条结果对比。评测数据存储在 `mastra` schema。

---

## 数据集与条目

- **数据集**：名称 / 描述，条目数与版本随修改自动维护；
- **条目**：`input`（问题）+ `groundTruth`（期望答案，可选——部分打分器需要）。

## 实验

发起实验时选择：**数据集** + **评测目标**（`arcbase-chat` / 自定义智能体 / 内置智能体）+ **打分器**（多选）。

- 实验异步执行（Mastra Experiments 自带调度），状态流转 `pending → running → completed / failed`；
- 结果视图：按打分器聚合平均分 + 逐条明细（输入 / 期望 / 实际输出 / 各打分器评分 / LLM 打分理由 / 错误）。

## 打分器

| 打分器 | 类型 | 说明 |
| --- | --- | --- |
| `ground-truth` | code | 与期望答案的重合度（bigram，中英文通用，无 LLM 成本，默认选中） |
| `answer-similarity` | LLM | 与期望答案的语义相似度（需期望答案） |
| `answer-relevancy` | LLM | 回答与问题的相关性 |
| `toxicity` | LLM | 毒性检测（反向指标，越低越好） |
| `bias` | LLM | 偏见检测（反向指标） |

LLM 类打分器为 **LLM-as-judge**：以当前系统默认服务商配置为评审模型，实验发起时自动按配置刷新注册；打分理由随结果回显。

## 接口一览

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| `GET` | `/api/ai/eval/datasets` | 数据集列表 | `ai:eval:list` |
| `POST` | `/api/ai/eval/datasets` | 创建数据集 / 管理条目 | `ai:eval:manage` |
| `GET` | `/api/ai/eval/experiments` | 实验列表 | `ai:eval:list` |
| `POST` | `/api/ai/eval/experiments` | 发起实验 | `ai:eval:manage` |
| `GET` | `/api/ai/eval/experiments/{id}` | 实验详情与逐条结果 | `ai:eval:list` |

> 实验与数据集同样可在 [Mastra Studio](./studio.md) 中查看与调试。
