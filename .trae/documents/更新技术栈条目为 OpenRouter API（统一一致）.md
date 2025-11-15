## 目标

将技术文档中的技术栈表（第1章技术选型）将“AI - LLM”项从“DeepSeek Chat API”更新为“OpenRouter API”，与AI对话与翻译垂直切片的一致性保持同步。并修正一处模型层描述以体现“主接入 OpenRouter，支持多模型”。

## 拟更新位置与内容

### 1) 技术栈表条目（L32）

* 当前位置：`f:/reader/Athena/雅典娜技术文档.md#L32`

* 原文：`| AI - LLM | DeepSeek Chat API | 采用API模式，避免前期GPU硬件投入。 |`

* 替换为：
  `| AI - LLM | OpenRouter API（Anthropic/OpenAI/DeepSeek 等） | 统一路由聚合与计费，避免前期GPU硬件投入。 |`

### 2) 模型层说明（L3373）

* 当前位置：`f:/reader/Athena/雅典娜技术文档.md:3373`

* 原文：`**模型层**: 支持多模型接入，包括DeepSeek Chat、Qwen-Embedding等`

* 替换为：
  `**模型层**：主接入 OpenRouter（路由聚合），支持多模型（Anthropic、OpenAI、DeepSeek 等）；Embedding 维持 Qwen-Embedding。`

## 一致性检查

* 与已存在的 OpenRouter 架构描述（L2799、L2801、L2811、L5714）保持一致，不改动其他段落

* 不调整 `AI - Embedding | Qwen-Embedding API`，以维持既定 embedding 方案

## 变更范围

* 仅上述两处文本替换，无其他结构改动

## 风险与回滚

* 纯文案替换，无代码/DDL变更；如需回滚，保留原文备份即可

