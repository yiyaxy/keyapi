# usage_money 字段对接文档（第三方）

本文档面向调用本服务 OpenAI 兼容接口的第三方开发者，说明响应中新增的 `usage_money` 字段如何使用。

## 概述

调用 `/v1/chat/completions` 时，响应的 `usage` 对象中会额外返回 `usage_money` 字段，表示**本次请求消耗的金额**。你不再需要拿 token 数自己去对价格表反算，直接读这个字段即可。

- **单位**：美元（USD）
- **类型**：浮点数（number）
- **精度**：6 位小数
- **取值**：等于本次请求**实际扣费金额**（与账单严格一致）

## 字段语义

| 情况 | `usage_money` 表现 |
|------|--------------------|
| 正常计费 | 返回金额，如 `0.001234` |
| 免费模型（有 token 但费率为 0） | 返回 `0` |
| 无法计费（上游未返回用量 / 本次无可计费 token） | **字段省略**（响应中不出现 `usage_money`） |

> 即：`usage_money` 缺失 = “本次无计费信息”；`usage_money: 0` = “本次确实免费”。请按是否存在该字段来区分这两种语义。

## 非流式（默认）

请求：

```bash
curl https://<your-host>/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

响应（节选）：

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "choices": [ ... ],
  "usage": {
    "prompt_tokens": 9,
    "completion_tokens": 12,
    "total_tokens": 21,
    "usage_money": 0.000084
  }
}
```

读取路径：`response.usage.usage_money`。

## 流式

流式场景下，`usage_money` 出现在**带 `usage` 的那个最终 chunk** 里。建议在请求中显式开启 usage 回传：

```bash
curl -N https://<your-host>/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "stream": true,
    "stream_options": { "include_usage": true },
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

最终的 usage chunk（`choices` 为空数组，携带 `usage`）：

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":12,"total_tokens":21,"usage_money":0.000084}}

data: [DONE]
```

解析要点：

- 遍历 SSE 流，**取那个 `usage` 非空的 chunk**，读 `chunk.usage.usage_money`。
- 该 chunk 的 `choices` 为空数组 `[]`，解析时不要越界访问 `choices[0]`。
- 整个流中 `usage_money` 只会出现一次。

## 解析示例

### Python

```python
import json
import requests

resp = requests.post(
    "https://<your-host>/v1/chat/completions",
    headers={"Authorization": "Bearer <YOUR_API_KEY>"},
    json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hello"}]},
)
usage = resp.json().get("usage", {})
money = usage.get("usage_money")  # None 表示本次无计费信息
if money is not None:
    print(f"本次花费 ${money:.6f}")
```

流式：

```python
import json, requests

with requests.post(
    "https://<your-host>/v1/chat/completions",
    headers={"Authorization": "Bearer <YOUR_API_KEY>"},
    json={
        "model": "gpt-4o",
        "stream": True,
        "stream_options": {"include_usage": True},
        "messages": [{"role": "user", "content": "hello"}],
    },
    stream=True,
) as r:
    for line in r.iter_lines():
        if not line:
            continue
        line = line.decode("utf-8").removeprefix("data: ")
        if line == "[DONE]":
            break
        chunk = json.loads(line)
        usage = chunk.get("usage")
        if usage and usage.get("usage_money") is not None:
            print(f"本次花费 ${usage['usage_money']:.6f}")
```

### Node.js（非流式）

```js
const resp = await fetch("https://<your-host>/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer <YOUR_API_KEY>",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-4o",
    messages: [{ role: "user", content: "hello" }],
  }),
});
const data = await resp.json();
const money = data.usage?.usage_money; // undefined 表示本次无计费信息
if (money !== undefined) {
  console.log(`本次花费 $${money}`);
}
```

## 适用范围与注意事项

- **仅 OpenAI 兼容格式**：`usage_money` 当前只在 OpenAI 协议的 `/v1/chat/completions` 响应中返回。Claude（`/v1/messages`）、Gemini 等其它协议格式暂不包含此字段。
- **金额一致性**：`usage_money` 由与实际扣费完全相同的计算逻辑得出，可直接用于对账。
- **币种换算**：如需人民币等其它币种，请在你侧按自己的汇率换算；本字段固定返回 USD。
- **边界提示（流式 + 渠道改写）**：当某渠道启用了响应改写规则、且上游自带 usage chunk 时，线上回传的 chunk 可能不携带 usage（属既有行为）。此为少数渠道配置下的边界情况；该场景不影响计费本身，仅影响流式回显中的 usage 对象是否出现。如对此有强需求，请联系服务方确认对应渠道配置。
