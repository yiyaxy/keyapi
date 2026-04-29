import { type EnabledAiModel, LOBE_DEFAULT_MODEL_LIST, ModelProvider } from 'model-bank';

import { type AiProviderRuntimeState, type EnabledProvider } from '@/types/aiProvider';

const PRICING_CACHE_TTL = 60_000;
const PRICING_FETCH_TIMEOUT = 5000;
const OPENAI_PROVIDER_ID = ModelProvider.OpenAI;

type PricingModel = {
  model_name: string;
  supported_endpoint_types?: string[];
};

type PricingResponse = {
  data?: PricingModel[];
  success?: boolean;
};

let pricingCache:
  | {
      expiresAt: number;
      models: EnabledAiModel[];
    }
  | undefined;

const FRIENDLY_MODEL_NAMES: Record<string, string> = {
  'gemini-3-pro-image-preview': 'Nano Banana Pro',
  'gemini-3.1-flash-image-preview': 'Nano Banana 2',
};

const formatModelDisplayName = (modelId: string) => {
  if (FRIENDLY_MODEL_NAMES[modelId]) return FRIENDLY_MODEL_NAMES[modelId];

  return modelId
    .split(/[-_:/.]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (['gpt', 'ai', 'api'].includes(lower)) return lower.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
};

const resolvePricingUrl = () => {
  const explicitUrl = process.env.MODEL_PRICING_URL || process.env.OPENAI_PRICING_URL;
  if (explicitUrl) return explicitUrl;

  const proxyUrl = process.env.OPENAI_PROXY_URL;
  if (!proxyUrl) return;

  try {
    const url = new URL(proxyUrl);
    const basePath = url.pathname.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    url.pathname = `${basePath}/api/pricing`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return;
  }
};

const getKnownModel = (modelId: string, isImage: boolean) => {
  if (isImage) {
    const imageAlias = modelId.endsWith(':image') ? modelId : `${modelId}:image`;
    const imageModel = LOBE_DEFAULT_MODEL_LIST.find((model) => model.id === imageAlias);
    if (imageModel) return imageModel;
  }

  return (
    LOBE_DEFAULT_MODEL_LIST.find(
      (model) => model.id === modelId && model.providerId === OPENAI_PROVIDER_ID,
    ) || LOBE_DEFAULT_MODEL_LIST.find((model) => model.id === modelId)
  );
};

const transformPricingModel = (item: PricingModel): EnabledAiModel | undefined => {
  const modelId = item.model_name?.trim();
  if (!modelId) return;

  const endpointTypes = new Set(item.supported_endpoint_types || []);
  const isImageModel = endpointTypes.has('image-generation');
  const isChatModel =
    !isImageModel &&
    (endpointTypes.has('openai') || endpointTypes.has('gemini') || endpointTypes.has('anthropic'));

  if (!isImageModel && !isChatModel) return;

  const knownModel = getKnownModel(modelId, isImageModel);

  return {
    abilities: knownModel?.abilities || {},
    contextWindowTokens: knownModel?.contextWindowTokens,
    displayName:
      FRIENDLY_MODEL_NAMES[modelId] || knownModel?.displayName || formatModelDisplayName(modelId),
    enabled: true,
    id: modelId,
    parameters: isImageModel ? knownModel?.parameters : undefined,
    providerId: OPENAI_PROVIDER_ID,
    releasedAt: knownModel?.releasedAt,
    type: isImageModel ? 'image' : 'chat',
  };
};

export const fetchPricingModels = async (): Promise<EnabledAiModel[] | undefined> => {
  if (pricingCache && pricingCache.expiresAt > Date.now()) return pricingCache.models;

  const pricingUrl = resolvePricingUrl();
  if (!pricingUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRICING_FETCH_TIMEOUT);

  try {
    const response = await fetch(pricingUrl, { signal: controller.signal });
    if (!response.ok) return;

    const payload = (await response.json()) as PricingResponse;
    if (payload.success === false || !Array.isArray(payload.data)) return;

    const seen = new Set<string>();
    const models = payload.data
      .map(transformPricingModel)
      .filter((model): model is EnabledAiModel => {
        if (!model || seen.has(`${model.providerId}:${model.id}:${model.type}`)) return false;
        seen.add(`${model.providerId}:${model.id}:${model.type}`);
        return true;
      });

    pricingCache = {
      expiresAt: Date.now() + PRICING_CACHE_TTL,
      models,
    };

    return models;
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }
};

const createGatewayProvider = (): EnabledProvider => {
  return {
    id: OPENAI_PROVIDER_ID,
    name: 'All Models',
    source: 'builtin',
  };
};

export const applyPricingModelsToRuntimeState = async (
  runtimeState: AiProviderRuntimeState,
): Promise<AiProviderRuntimeState> => {
  const pricingModels = await fetchPricingModels();
  if (!pricingModels?.length) return runtimeState;

  const enabledAiModels = pricingModels;
  const enabledAiProviders = [createGatewayProvider()];

  const enabledChatAiProviders = enabledAiProviders.filter((provider) =>
    enabledAiModels.some((model) => model.providerId === provider.id && model.type === 'chat'),
  );
  const enabledImageAiProviders = enabledAiProviders.filter((provider) =>
    enabledAiModels.some((model) => model.providerId === provider.id && model.type === 'image'),
  );
  const enabledVideoAiProviders = enabledAiProviders.filter((provider) =>
    enabledAiModels.some((model) => model.providerId === provider.id && model.type === 'video'),
  );

  return {
    ...runtimeState,
    enabledAiModels,
    enabledAiProviders,
    enabledChatAiProviders,
    enabledImageAiProviders,
    enabledVideoAiProviders,
  };
};
