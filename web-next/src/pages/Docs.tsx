import { marked } from 'marked';
import { useMemo } from 'react';

const DOC_CONTENT = `
# 文档

欢迎使用 ALL Models API 网关。本文档帮助你快速完成接入，并了解核心功能。

---

## 快速开始

### 1. 获取 API Key

登录控制台后，前往 **API Keys** 页面创建一个密钥。密钥格式为 \`sk-xxx\`，请妥善保管，不要泄露。

### 2. 设置 Base URL

将你的客户端或 SDK 的请求地址替换为：

\`\`\`
https://你的域名/v1
\`\`\`

### 3. 第一个请求

ALL Models 完全兼容 OpenAI 接口协议，任何支持 OpenAI SDK 的客户端均可直接使用。

**Python 示例**

\`\`\`python
from openai import OpenAI

client = OpenAI(
    api_key="sk-你的密钥",
    base_url="https://你的域名/v1",
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(response.choices[0].message.content)
\`\`\`

**JavaScript / TypeScript 示例**

\`\`\`typescript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'sk-你的密钥',
  baseURL: 'https://你的域名/v1',
});

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});

console.log(response.choices[0].message.content);
\`\`\`

---

## 支持的接口

| 接口路径 | 说明 |
|---|---|
| \`POST /v1/chat/completions\` | 对话补全（流式 / 非流式） |
| \`POST /v1/completions\` | 文本补全 |
| \`POST /v1/embeddings\` | 向量嵌入 |
| \`POST /v1/images/generations\` | 图像生成 |
| \`GET /v1/models\` | 查询可用模型列表 |

所有接口与 OpenAI 官方文档保持一致，参数兼容。

---

## 支持的模型供应商

| 供应商 | 示例模型 |
|---|---|
| OpenAI | gpt-4o, gpt-4-turbo, o1 |
| Anthropic | claude-opus-4-7, claude-sonnet-4-6 |
| Google | gemini-2.0-flash, gemini-1.5-pro |
| DeepSeek | deepseek-chat, deepseek-r1 |
| Mistral | mistral-large-latest |
| 更多 | 见定价页完整列表 |

在请求中直接使用对应的模型名称即可，无需任何其他配置。

---

## 额度与计费

### Quota 体系

平台使用统一的 **Quota 单位**计费：

> **500,000 Quota = $1 美元**

每个模型的输入 / 输出单价（每百万 token 消耗的 Quota 数）均在 [定价页](/pricing) 公示。

### 查询余额

在控制台首页或 **充值** 页面均可查看当前 Quota 余额。

---

## 流量限制

| 维度 | 默认限制 |
|---|---|
| 每分钟请求数（RPM） | 视分组配置而定 |
| 每分钟 Token 数（TPM） | 视分组配置而定 |
| 单次请求最大 Token | 取决于所用模型 |

如需提升限额，请联系管理员或在控制台提交工单。

---

## 常见问题

**Q：返回 401 Unauthorized 怎么办？**

请确认 API Key 填写正确且未过期，同时检查请求头格式：

\`\`\`
Authorization: Bearer sk-你的密钥
\`\`\`

**Q：返回 429 Too Many Requests 怎么办？**

已触发限流，请降低请求频率或联系管理员申请更高限额。

**Q：如何在现有项目中切换到 ALL Models？**

只需修改两个参数：
1. \`OPENAI_API_KEY\` → 换成你的 ALL Models 密钥
2. \`OPENAI_BASE_URL\` → 换成 \`https://你的域名/v1\`

其余代码无需改动。

---

## 联系与支持

- 控制台工单：登录后前往 **工单** 页面提交
- 通过 [关于](/about) 页面查看更多信息
`;

marked.setOptions({ gfm: true, breaks: false });

export function DocsPage() {
  const html = useMemo(() => marked.parse(DOC_CONTENT) as string, []);

  return (
    <div className='mx-auto max-w-3xl'>
      <div className='prose' dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
