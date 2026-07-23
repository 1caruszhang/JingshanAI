# SKILL.md Frontmatter Schema

每个 `skills/<skill-name>/SKILL.md` 文件**必须**以 YAML frontmatter 开头，由 `---` 分隔，格式如下。

## 字段说明

```yaml
---
name: <string>                  # Skill 唯一标识符，与目录名一致，用于路由和日志
description: <string>           # 一句话描述，供 DeepSeek 语义路由 embedding 使用；50–150 字符
domains:                        # 适用的 domain 枚举列表；空列表表示全 domain 通用
  - local_service               #   本地服务行业（门店、代理商等）
  - saas                        #   SaaS / 软件产品
  - ecommerce                   #   电商 / 零售
capabilities:                   # 该 Skill 能处理的意图标识符列表，规则路由时用于关键词匹配
  - <intent_id>                 #   如: generate_support_article, select_ranking_theme
preconditions:                  # 前置状态条件列表，由 allowedActionPolicy 在路由层检查
  - <expression>                #   如: confirmed_facts_count > 0, project.domain != null
risk_level: low | medium | high # 风险等级
                                #   low: 只读 / 纯生成，无副作用
                                #   medium: 写入草稿或内存，可撤销
                                #   high: 发布、外部写入、不可逆操作
requires_confirmation: <bool>   # 步骤完成后是否默认推确认卡片给用户
---
```

## 字段约束

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `name` | string | ✅ | 与目录名完全一致；只含小写字母、数字、连字符 |
| `description` | string | ✅ | 50–150 字符；以动词开头；不含换行 |
| `domains` | string[] | ✅ | 枚举值：`local_service` / `saas` / `ecommerce`；空列表合法 |
| `capabilities` | string[] | ✅ | 至少 1 个；格式 `snake_case`；代表该 Skill 可处理的用户意图 |
| `preconditions` | string[] | ✅ | 可为空列表；每条为可读的布尔表达式字符串，由 `allowedActionPolicy` 解析 |
| `risk_level` | enum | ✅ | `low` / `medium` / `high` |
| `requires_confirmation` | boolean | ✅ | `true` / `false` |

## 常用 precondition 表达式

| 表达式 | 含义 |
|--------|------|
| `confirmed_facts_count > 0` | 项目已有至少 1 条已确认事实 |
| `evidence_pack_available` | RAG 服务已为当前项目生成 Evidence Pack |
| `project.domain != null` | 项目已设置 domain 字段 |
| `ranking_entries_count >= 2` | 已有至少 2 条排行榜入选数据 |
| `ranking_criteria_defined` | 排行榜评选标准已生成 |
| `ranking_theme_selected` | 排行榜主题已选定 |
| `article_outline_available` | 文章大纲已生成 |
| `claim_text_provided` | 已提供需要溯源的 Claim 文本 |

## body 结构约定

frontmatter 后的 Markdown body **推荐**包含以下段落（按需取舍）：

1. `## 目标` — 该 Skill 要实现什么
2. `## 使用场景` — 在何处、何时由 Agent 调用
3. `## 输入` — 输入参数说明
4. `## 输出` — 输出结构说明（JSON schema 或示例）
5. `## 约束` — 禁止事项、边界条件
6. `## Domain 差异` — 按 domain 分节，说明不同行业的特化逻辑（如有）

## 验证

启动时 `electron/services/agent/skillRegistry.ts` 会：

1. 遍历 `skills/*/SKILL.md`
2. 用 `js-yaml` 解析 frontmatter
3. 用内置 schema 校验所有必填字段
4. 校验失败时抛出错误，阻止 Agent 启动

新增或修改 `SKILL.md` 后，可运行 `npm run validate:skills` 单独验证。
