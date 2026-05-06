import { ASYNC_TASK_TIMEOUT } from '@lobechat/business-config/server';
import { ENABLE_BUSINESS_FEATURES } from '@lobechat/business-const';
import {
  buildMappedBusinessModelFields,
  resolveBusinessModelMapping,
} from '@lobechat/business-model-runtime';
import { AgentRuntimeErrorType } from '@lobechat/model-runtime';
import {
  AsyncTaskError,
  AsyncTaskErrorType,
  AsyncTaskStatus,
  RequestTrigger,
} from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import debug from 'debug';
import { and, eq } from 'drizzle-orm';
import { ModelProvider, type RuntimeImageGenParams } from 'model-bank';
import { z } from 'zod';

import { getProviderContentPolicyErrorMessage } from '@/business/server/getProviderContentPolicyErrorMessage';
import { chargeAfterGenerate } from '@/business/server/image-generation/chargeAfterGenerate';
import { notifyImageCompleted } from '@/business/server/image-generation/notifyImageCompleted';
import { createImageBusinessMiddleware } from '@/business/server/trpc-middlewares/async';
import { AsyncTaskModel } from '@/database/models/asyncTask';
import { FileModel } from '@/database/models/file';
import { GenerationModel } from '@/database/models/generation';
import { GenerationBatchModel } from '@/database/models/generationBatch';
import { aiProviders } from '@/database/schemas';
import { asyncAuthedProcedure, asyncRouter as router } from '@/libs/trpc/async';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { GenerationService } from '@/server/services/generation';
import { sanitizeFileName } from '@/utils/sanitizeFileName';

import { getContentPolicyErrorMessage } from './contentPolicyError';

const log = debug('lobe-image:async');

const IMAGE_URL_PREVIEW_LENGTH = 100;

const imageProcedure = asyncAuthedProcedure.use(async (opts) => {
  const { ctx } = opts;

  return opts.next({
    ctx: {
      asyncTaskModel: new AsyncTaskModel(ctx.serverDB, ctx.userId),
      fileModel: new FileModel(ctx.serverDB, ctx.userId),
      generationBatchModel: new GenerationBatchModel(ctx.serverDB, ctx.userId),
      generationModel: new GenerationModel(ctx.serverDB, ctx.userId),
      generationService: new GenerationService(ctx.serverDB, ctx.userId),
    },
  });
});

const createImageInputSchema = z.object({
  generationBatchId: z.string(),
  generationId: z.string(),
  generationTopicId: z.string(),
  model: z.string(),
  params: z
    .object({
      cfg: z.number().optional(),
      height: z.number().optional(),
      imageUrls: z.array(z.string()).optional(),
      prompt: z.string(),
      seed: z.number().nullable().optional(),
      steps: z.number().optional(),
      width: z.number().optional(),
    })
    .passthrough(),
  provider: z.string(),
  taskId: z.string(),
});

/**
 * Checks if the abort signal has been triggered and throws an error if so
 */
const checkAbortSignal = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new Error('Operation was aborted');
  }
};

type GatewayImageConfig = {
  apiKey: string;
  baseURL: string;
};

type GatewayImageResponse = {
  height?: number;
  imageFetchHeaders?: Record<string, string>;
  imageUrl: string;
  isPrivateImageUrl?: boolean;
  modelUsage?: any;
  width?: number;
};

type AsyncImageTaskResponse = {
  error?: { code?: string; message?: string } | null;
  progress?: number | string;
  result?: unknown;
  status?: string;
  task_id?: string;
};

const normalizeBaseURL = (url: string) => url.replace(/\/+$/, '');

const isGatewayAsyncContentUrl = (imageUrl: string, baseURL: string) => {
  try {
    const image = new URL(imageUrl);
    const base = new URL(baseURL);
    const basePath = base.pathname.replace(/\/+$/, '');
    return image.origin === base.origin && image.pathname.startsWith(`${basePath}/images/async/`);
  } catch {
    return false;
  }
};

const resolveProxyBaseURL = () => {
  const explicitProxyUrl = process.env.OPENAI_PROXY_URL?.trim();
  if (explicitProxyUrl) return normalizeBaseURL(explicitProxyUrl);

  const baseUrl = process.env.NEW_API_BASE_URL?.trim();
  if (!baseUrl) return;

  return `${normalizeBaseURL(baseUrl)}/v1`;
};

const resolveGatewayImageConfig = async (
  ctx: { serverDB: any; userId: string },
  provider: string,
): Promise<GatewayImageConfig | undefined> => {
  if (provider !== ModelProvider.OpenAI) return;

  const [providerRow] = await ctx.serverDB
    .select({ keyVaults: aiProviders.keyVaults })
    .from(aiProviders)
    .where(and(eq(aiProviders.id, provider), eq(aiProviders.userId, ctx.userId)))
    .limit(1);

  const keyVaults = (await KeyVaultsGateKeeper.getUserKeyVaults(
    providerRow?.keyVaults ?? null,
    ctx.userId,
  )) as {
    apiKey?: string;
    baseURL?: string;
    endpoint?: string;
  };

  const apiKey = keyVaults.apiKey || process.env.OPENAI_API_KEY;
  const baseURL = keyVaults.baseURL || keyVaults.endpoint || resolveProxyBaseURL();

  if (!apiKey || !baseURL) return;

  return { apiKey, baseURL: normalizeBaseURL(baseURL) };
};

const safeReadError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const parseAsyncSubmitResponse = (body: unknown) => {
  const taskId =
    (body as { task_id?: string }).task_id ??
    (body as { data?: { task_id?: string } }).data?.task_id ??
    (body as { data?: Array<{ task_id?: string }> }).data?.[0]?.task_id;

  if (!taskId) throw new Error('Async image API returned no task_id');
  return taskId;
};

const normalizeAsyncStatus = (status?: string) => {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete'].includes(value)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(value)) return 'failed';
  if (['processing', 'running', 'in_progress'].includes(value)) return 'running';
  return 'queued';
};

const collectImageUrls = (value: unknown): string[] => {
  if (!value) return [];
  if (typeof value === 'string') {
    return /^https?:\/\/.+\.(?:png|jpe?g|webp)(?:\?.*)?$/i.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectImageUrls(item));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      collectImageUrls(item),
    );
  }
  return [];
};

const isLikelyPreviewUrl = (url: string) => /thumb|preview|small|low|compressed/i.test(url);

const isLikelyFinalImageUrl = (url: string) => /gpt|image|poster|task|upload/i.test(url);

const parseImageResponse = (body: unknown) => {
  const data = (body as { data?: Array<{ b64_json?: string; url?: string }> }).data;
  const first = data?.[0];
  if (first?.url && !isLikelyPreviewUrl(first.url)) return first.url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;

  const urls = collectImageUrls(body);
  const bestUrl =
    urls.find((url) => !isLikelyPreviewUrl(url) && isLikelyFinalImageUrl(url)) ??
    urls.find((url) => !isLikelyPreviewUrl(url)) ??
    urls[0];

  if (bestUrl) return bestUrl;
  if (first?.url) return first.url;

  throw new Error('Image API returned no url or b64_json');
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Operation was aborted'));
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error('Operation was aborted'));
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });

const buildGatewayImagePayload = (model: string, params: RuntimeImageGenParams) => {
  const imageUrls = [
    typeof (params as any).imageUrl === 'string' ? (params as any).imageUrl : undefined,
    ...(Array.isArray((params as any).imageUrls) ? (params as any).imageUrls : []),
  ].filter((url): url is string => Boolean(url));

  const width = typeof (params as any).width === 'number' ? (params as any).width : undefined;
  const height = typeof (params as any).height === 'number' ? (params as any).height : undefined;
  const size =
    typeof (params as any).size === 'string'
      ? (params as any).size
      : width && height
        ? `${width}x${height}`
        : undefined;

  return {
    ...(imageUrls[0] ? { image: imageUrls[0] } : {}),
    ...(imageUrls.length > 0 ? { images: imageUrls } : {}),
    ...(typeof (params as any).output_format === 'string'
      ? { output_format: (params as any).output_format }
      : {}),
    ...(typeof (params as any).quality === 'string' ? { quality: (params as any).quality } : {}),
    ...(size ? { size } : {}),
    model,
    n: 1,
    prompt: params.prompt,
  };
};

const createGatewayAsyncImage = async ({
  config,
  model,
  params,
  signal,
}: {
  config: GatewayImageConfig;
  model: string;
  params: RuntimeImageGenParams;
  signal: AbortSignal;
}): Promise<GatewayImageResponse> => {
  const submitResponse = await fetch(`${config.baseURL}/images/async`, {
    body: JSON.stringify(buildGatewayImagePayload(model, params)),
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal,
  });

  if (!submitResponse.ok) {
    throw new Error(`Async image task submit failed: ${await safeReadError(submitResponse)}`);
  }

  const upstreamTaskId = parseAsyncSubmitResponse(await submitResponse.json());
  const startedAt = Date.now();
  let delayMs = 2500;

  while (Date.now() - startedAt < ASYNC_TASK_TIMEOUT) {
    await sleep(delayMs, signal);
    checkAbortSignal(signal);

    const pollResponse = await fetch(
      `${config.baseURL}/images/async/${encodeURIComponent(upstreamTaskId)}`,
      {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal,
      },
    );

    if (!pollResponse.ok) {
      throw new Error(`Async image task query failed: ${await safeReadError(pollResponse)}`);
    }

    const body = (await pollResponse.json()) as AsyncImageTaskResponse;
    const status = normalizeAsyncStatus(body.status);

    if (status === 'succeeded') {
      if (!body.result) throw new Error('Async image task completed with empty result');
      const imageUrl = parseImageResponse(body.result);
      const isPrivateImageUrl = isGatewayAsyncContentUrl(imageUrl, config.baseURL);

      return {
        ...(isPrivateImageUrl
          ? { imageFetchHeaders: { Authorization: `Bearer ${config.apiKey}` } }
          : {}),
        imageUrl,
        isPrivateImageUrl,
      };
    }

    if (status === 'failed') {
      throw new Error(body.error?.message || 'Async image task failed');
    }

    delayMs = Math.min(6000, Math.round(delayMs * 1.15));
  }

  throw new Error('Async image task timed out');
};

/**
 * Categorizes errors into appropriate AsyncTaskErrorType
 * Returns the original error message if available, otherwise returns the error type as message
 * Client should handle localization based on errorType
 */
const categorizeError = (
  error: any,
  isAborted: boolean,
  isEditingImage: boolean,
  providerContentPolicyMessage?: string,
): { errorMessage: string; errorType: AsyncTaskErrorType } => {
  log('🔥🔥🔥 [ASYNC] categorizeError called:', {
    errorMessage: error?.message,
    errorName: error?.name,
    errorStatus: error?.status,
    errorType: error?.errorType,
    fullError: JSON.stringify(error, null, 2),
    isAborted,
    isEditingImage,
  });
  // Handle Comfy UI errors
  if (error.errorType === AgentRuntimeErrorType.ComfyUIServiceUnavailable) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIServiceUnavailable,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIBizError) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIBizError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIWorkflowError) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIWorkflowError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ComfyUIModelError) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.ComfyUIModelError,
      errorType: AsyncTaskErrorType.ModelNotFound,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ConnectionCheckFailed) {
    return {
      errorMessage: error.message || AgentRuntimeErrorType.ConnectionCheckFailed,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.PermissionDenied) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.PermissionDenied,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ModelNotFound) {
    return {
      errorMessage: error.error?.message || error.message || AgentRuntimeErrorType.ModelNotFound,
      errorType: AsyncTaskErrorType.ModelNotFound,
    };
  }

  if (error.errorType === AgentRuntimeErrorType.ProviderNoImageGenerated) {
    return {
      errorMessage: isEditingImage
        ? 'Provider returned no image (maybe content review). Try a safer source image or milder prompt.'
        : 'Provider returned no image (maybe content review). Try a milder prompt or another model.',
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  // FIXME: 401 errors should be handled in agentRuntime for better practice
  if (error.errorType === AgentRuntimeErrorType.InvalidProviderAPIKey || error?.status === 401) {
    return {
      errorMessage:
        error.error?.message || error.message || AgentRuntimeErrorType.InvalidProviderAPIKey,
      errorType: AsyncTaskErrorType.InvalidProviderAPIKey,
    };
  }

  if (providerContentPolicyMessage) {
    return {
      errorMessage: providerContentPolicyMessage,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    };
  }

  const fallbackContentPolicyMessage = getContentPolicyErrorMessage(error);
  if (fallbackContentPolicyMessage) {
    return {
      errorMessage: fallbackContentPolicyMessage,
      errorType: AsyncTaskErrorType.ProviderContentModeration,
    };
  }

  if (error instanceof AsyncTaskError) {
    return {
      errorMessage: typeof error.body === 'string' ? error.body : error.body.detail,
      errorType: error.name as AsyncTaskErrorType,
    };
  }

  if (isAborted || error.message?.includes('aborted')) {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('timeout') || error.name === 'TimeoutError') {
    return {
      errorMessage: AsyncTaskErrorType.Timeout,
      errorType: AsyncTaskErrorType.Timeout,
    };
  }

  if (error.message?.includes('network') || error.name === 'NetworkError') {
    return {
      errorMessage: error.message || AsyncTaskErrorType.ServerError,
      errorType: AsyncTaskErrorType.ServerError,
    };
  }

  return {
    errorMessage: error.message || error.error?.message || AsyncTaskErrorType.ServerError,
    errorType: AsyncTaskErrorType.ServerError,
  };
};

export const imageRouter = router({
  createImage: imageProcedure
    .use(createImageBusinessMiddleware)
    .input(createImageInputSchema)
    .mutation(async ({ input, ctx }) => {
      const {
        taskId,
        generationId,
        generationBatchId,
        generationTopicId,
        provider,
        model,
        params,
      } = input;

      log('Starting async image generation: %O', {
        generationId,
        imageParams: {
          cfg: params.cfg,
          height: params.height,
          steps: params.steps,
          width: params.width,
        },
        model,
        prompt: params.prompt,
        provider,
        taskId,
      });

      // Check if generationBatch exists before processing
      const generationBatch = await ctx.generationBatchModel.findById(generationBatchId);
      if (!generationBatch) {
        log('Generation batch not found: %s, skipping image generation', generationBatchId);
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Invalid Request!' });
      }

      log('Updating task status to Processing: %s', taskId);
      await ctx.asyncTaskModel.update(taskId, { status: AsyncTaskStatus.Processing });

      // Use AbortController to prevent resource leaks
      const abortController = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const isEditingImage =
        Boolean((params as any).imageUrl) ||
        Boolean(params.imageUrls && params.imageUrls.length > 0);

      try {
        const imageGenerationPromise = async (signal: AbortSignal) => {
          const { requestedModelId, resolvedModelId } = await resolveBusinessModelMapping(
            provider,
            model,
          );

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          let response: GatewayImageResponse | undefined;
          const gatewayImageConfig = await resolveGatewayImageConfig(ctx, provider);

          if (gatewayImageConfig) {
            log('Submitting image generation through gateway async API');
            response = await createGatewayAsyncImage({
              config: gatewayImageConfig,
              model: resolvedModelId,
              params: params as unknown as RuntimeImageGenParams,
              signal,
            });
          } else {
            log('Initializing agent runtime for provider: %s', provider);
            // Read user's provider config from database
            const modelRuntime = await initModelRuntimeFromDB(ctx.serverDB, ctx.userId, provider);

            checkAbortSignal(signal);
            log('Agent runtime initialized, calling createImage');
            response = await modelRuntime.createImage!(
              {
                model: resolvedModelId,
                params: params as unknown as RuntimeImageGenParams,
              },
              { metadata: { trigger: RequestTrigger.Image } },
            );

            // Extract ComfyUI authentication headers if provider is ComfyUI
            if (provider === 'comfyui') {
              // Use the public interface method to get auth headers
              // This avoids accessing private members and exposing credentials
              response.imageFetchHeaders = modelRuntime.getAuthHeaders();
              if (response.imageFetchHeaders) {
                log('Using authentication headers for ComfyUI image download');
              } else {
                log('No authentication configured for ComfyUI');
              }
            }
          }

          if (!response) {
            log('Create image response is empty');
            throw new Error('Create image response is empty');
          }

          log('Create image response: %O', {
            ...response,
            imageUrl: response.imageUrl?.startsWith('data:')
              ? response.imageUrl.slice(0, IMAGE_URL_PREVIEW_LENGTH) + '...'
              : response.imageUrl,
          });

          const { modelUsage } = response;

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Image generation successful: %O', {
            height: response.height,
            imageUrl: response.imageUrl.startsWith('data:')
              ? response.imageUrl.slice(0, IMAGE_URL_PREVIEW_LENGTH) + '...'
              : response.imageUrl,
            width: response.width,
          });

          log('Transforming image for generation');
          const { imageUrl, width, height } = response;

          const { image, thumbnailImage } = await ctx.generationService.transformImageForGeneration(
            imageUrl,
            response.imageFetchHeaders,
          );

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Uploading image for generation');
          const { imageUrl: uploadedImageUrl, thumbnailImageUrl } =
            await ctx.generationService.uploadImageForGeneration(image, thumbnailImage);

          // Check if operation has been cancelled
          checkAbortSignal(signal);

          log('Updating generation asset and file');
          await ctx.generationModel.createAssetAndFile(
            generationId,
            {
              height: height ?? image.height,
              // Avoid storing large base64 data or private gateway content URLs in DB.
              originalUrl:
                imageUrl.startsWith('data:') || response.isPrivateImageUrl
                  ? uploadedImageUrl
                  : imageUrl,
              thumbnailUrl: thumbnailImageUrl,
              type: 'image',
              url: uploadedImageUrl,
              width: width ?? image.width,
            },
            {
              fileHash: image.hash,
              fileType: image.mime,
              metadata: {
                generationId,
                height: image.height,
                path: uploadedImageUrl,
                width: image.width,
              },
              name: `${sanitizeFileName(params.prompt, generationId)}.${image.extension}`,
              size: image.size,
              url: uploadedImageUrl,
            },
          );

          const duration = Date.now() - generationBatch.createdAt.getTime();

          log('Updating task status to Success: %s, duration: %dms', taskId, duration);
          await ctx.asyncTaskModel.update(taskId, {
            duration,
            status: AsyncTaskStatus.Success,
          });

          try {
            await notifyImageCompleted({
              duration,
              generationBatchId,
              model,
              prompt: params.prompt,
              topicId: generationTopicId,
              userId: ctx.userId,
            });
          } catch (err) {
            console.error('[image-async] notification failed:', err);
          }

          if (ENABLE_BUSINESS_FEATURES) {
            await chargeAfterGenerate({
              metrics: { latency: duration },
              metadata: {
                asyncTaskId: taskId,
                generationBatchId,
                topicId: generationTopicId,
                ...buildMappedBusinessModelFields({
                  provider,
                  requestedModelId,
                  resolvedModelId,
                }),
              },
              modelUsage,
              provider,
              userId: ctx.userId,
            });
          }

          log('Async image generation completed successfully: %s', taskId);
          return { success: true };
        };

        // Set timeout to cancel operation and prevent resource leaks
        timeoutId = setTimeout(() => {
          log('Image generation timeout, aborting operation: %s', taskId);
          abortController.abort();
        }, ASYNC_TASK_TIMEOUT);

        const result = await imageGenerationPromise(abortController.signal);

        // Clean up timeout timer
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        return result;
      } catch (error: any) {
        // Clean up timeout timer
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        log('Async image generation failed: %O', {
          error: error.message || error,
          generationId,
          taskId,
        });

        // Improved error categorization logic
        const providerContentPolicyMessage = await getProviderContentPolicyErrorMessage({
          error,
          provider,
          userId: ctx.userId,
        });
        const { errorType, errorMessage } = categorizeError(
          error,
          abortController.signal.aborted,
          isEditingImage,
          providerContentPolicyMessage,
        );

        await ctx.asyncTaskModel.update(taskId, {
          error: new AsyncTaskError(errorType, errorMessage),
          status: AsyncTaskStatus.Error,
        });

        log('Task status updated to Error: %s, errorType: %s', taskId, errorType);

        return {
          message: `Image generation ${taskId} failed: ${errorMessage}`,
          success: false,
        };
      }
    }),
});
