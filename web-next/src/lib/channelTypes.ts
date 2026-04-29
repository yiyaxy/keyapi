export type ChannelTypeInfo = { id: number; name: string };

// Mirrors constant/channel.go. Kept to the 20 most common types for the
// MVP form; advanced types can reuse the numeric id directly via Other.
export const CHANNEL_TYPES: ChannelTypeInfo[] = [
  { id: 1, name: 'OpenAI' },
  { id: 3, name: 'Azure OpenAI' },
  { id: 14, name: 'Anthropic Claude' },
  { id: 24, name: 'Google Gemini' },
  { id: 43, name: 'DeepSeek' },
  { id: 25, name: 'Moonshot' },
  { id: 17, name: 'Alibaba Qwen' },
  { id: 15, name: 'Baidu ERNIE' },
  { id: 46, name: 'Baidu ERNIE v2' },
  { id: 26, name: 'Zhipu GLM v4' },
  { id: 45, name: 'ByteDance Volcano' },
  { id: 4, name: 'Ollama' },
  { id: 20, name: 'OpenRouter' },
  { id: 42, name: 'Mistral' },
  { id: 34, name: 'Cohere' },
  { id: 40, name: 'SiliconFlow' },
  { id: 41, name: 'Vertex AI' },
  { id: 33, name: 'AWS Bedrock' },
  { id: 48, name: 'xAI Grok' },
  { id: 58, name: 'Apimart' },
  { id: 8, name: 'Custom (OpenAI-compatible)' },
];

export function channelTypeName(id: number): string {
  const hit = CHANNEL_TYPES.find((t) => t.id === id);
  return hit ? hit.name : `Type #${id}`;
}
