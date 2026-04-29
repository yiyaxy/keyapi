import { loadBootstrap } from './bootstrap';

export type ImageDiagnosisStyleGoal =
  | 'daily_beauty'
  | 'commute'
  | 'dating'
  | 'workplace'
  | 'elegant';

export type ImageDiagnosisStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ImageDiagnosisCreateInput {
  imageFile: File;
  imageUrl: string;
  styleGoal: ImageDiagnosisStyleGoal;
}

export interface ImageDiagnosisCreateResult {
  code: number;
  data: {
    taskId: string;
    status: ImageDiagnosisStatus;
  };
}

export interface ImageDiagnosisTaskResult {
  code: number;
  data: {
    taskId: string;
    status: ImageDiagnosisStatus;
    progress: number;
    reportId?: string;
    message?: string;
  };
}

export interface ImageDiagnosisReport {
  id: string;
  imageUrl: string;
  posterUrl: string;
  styleGoal: ImageDiagnosisStyleGoal;
  model: string;
  prompt: string;
}

interface LocalTask {
  taskId: string;
  reportId: string;
  progress: number;
  status: ImageDiagnosisStatus;
  message: string;
}

const localTasks = new Map<string, LocalTask>();
const localReports = new Map<string, ImageDiagnosisReport>();

const appSlug = import.meta.env.VITE_IMAGE_DIAGNOSIS_APP_SLUG ?? 'image-diagnosis';
const imageModel = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_MODEL ?? 'gpt-image-2';
const imageSize = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_SIZE ?? 'auto';
// Local debug only. Paste a real sk- key here temporarily, or set
// localStorage.setItem('image-diagnosis-debug-token', 'sk-...')
const localDebugToken = '';

const goalText: Record<ImageDiagnosisStyleGoal, string> = {
  daily_beauty: '日常变美',
  commute: '通勤显气质',
  dating: '约会氛围感',
  workplace: '职场专业感',
  elegant: '轻熟高级感',
};

const goalBrief: Record<ImageDiagnosisStyleGoal, string> = {
  daily_beauty: '自然耐看、清爽提气色，适合日常自拍和生活分享',
  commute: '干净利落、有精神、不过度用力，适合通勤和轻商务',
  dating: '柔和松弛、甜感适中、有氛围感，适合约会和社交场景',
  workplace: '专业、可信赖、轮廓清晰，适合职场头像和商务沟通',
  elegant: '轻熟高级、克制精致，强调质感、线条和低饱和配色',
};

export function getImageDiagnosisGoalLabel(goal: ImageDiagnosisStyleGoal) {
  return goalText[goal];
}

export async function createImageDiagnosisTask(
  input: ImageDiagnosisCreateInput
): Promise<ImageDiagnosisCreateResult> {
  const taskId = `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const reportId = taskId.replace('diag_', 'report_');

  localTasks.set(taskId, {
    taskId,
    reportId,
    progress: 3,
    status: 'pending',
    message: '准备生成穿搭分析海报',
  });

  void runPosterGeneration(taskId, input);

  return {
    code: 0,
    data: {
      taskId,
      status: 'pending',
    },
  };
}

export async function getImageDiagnosisTask(taskId: string): Promise<ImageDiagnosisTaskResult> {
  const task = localTasks.get(taskId);
  if (!task) {
    return {
      code: 404,
      data: {
        taskId,
        status: 'failed',
        progress: 0,
        message: '任务不存在，请重新上传照片',
      },
    };
  }

  return {
    code: 0,
    data: {
      taskId,
      status: task.status,
      progress: task.progress,
      reportId: task.status === 'succeeded' ? task.reportId : undefined,
      message: task.message,
    },
  };
}

export async function getImageDiagnosisReport(reportId: string): Promise<ImageDiagnosisReport> {
  const report = localReports.get(reportId);
  if (!report) throw new Error('报告不存在，请重新生成');
  return report;
}

async function runPosterGeneration(taskId: string, input: ImageDiagnosisCreateInput) {
  const task = localTasks.get(taskId);
  if (!task) return;

  try {
    updateTask(taskId, 10, '获取应用调用凭证');
    const token = await resolveRelayToken();

    updateTask(taskId, 28, `调用 ${imageModel} 生成报告海报`);
    const prompt = buildPosterPrompt(input.styleGoal);
    const posterUrl = await callImageGenerationWithReference(token, input.imageFile, prompt);

    updateTask(taskId, 96, '整理报告图片');
    const report: ImageDiagnosisReport = {
      id: task.reportId,
      imageUrl: input.imageUrl,
      posterUrl,
      styleGoal: input.styleGoal,
      model: imageModel,
      prompt,
    };

    task.status = 'succeeded';
    task.progress = 100;
    task.message = '报告海报已生成';
    localReports.set(task.reportId, report);
  } catch (error) {
    task.status = 'failed';
    task.progress = Math.max(task.progress, 12);
    task.message =
      error instanceof Error ? error.message : '报告海报生成失败，请稍后重试或更换照片';
  }
}

function updateTask(taskId: string, progress: number, message: string) {
  const task = localTasks.get(taskId);
  if (!task) return;
  task.status = 'running';
  task.progress = Math.max(task.progress, progress);
  task.message = message;
}

async function resolveRelayToken(): Promise<string> {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token') || params.get('key');
  if (urlToken?.startsWith('sk-') && urlToken !== 'sk-preview') return urlToken;

  const debugToken = getLocalDebugToken();
  if (urlToken === 'sk-preview') {
    if (debugToken) return debugToken;
    throw new Error(
      "本地调试 token 未配置。请在 src/lib/imageDiagnosis.ts 填 localDebugToken，或在控制台执行 localStorage.setItem('image-diagnosis-debug-token', 'sk-你的测试key')。"
    );
  }

  if (debugToken) return debugToken;

  const cacheKey = `image-diagnosis-token:${appSlug}`;
  const cached = window.sessionStorage.getItem(cacheKey);
  if (cached?.startsWith('sk-')) return cached;

  const session = await requestAppSession(`/api/app/${appSlug}/session`);
  if (session?.key) {
    window.sessionStorage.setItem(cacheKey, session.key);
    return session.key;
  }

  throw new Error(
    `没有拿到应用调用凭证。请先登录，并确认 AI 应用后台已上架 slug=${appSlug} 的应用；调试时也可以在地址后追加 ?token=sk-...。`
  );
}

function getLocalDebugToken() {
  if (!import.meta.env.DEV) return '';
  const storageToken = window.localStorage.getItem('image-diagnosis-debug-token')?.trim() ?? '';
  const token = storageToken || localDebugToken.trim();
  if (!token || token === 'sk-preview') return '';
  return token.startsWith('sk-') ? token : `sk-${token}`;
}

async function requestAppSession(url: string): Promise<{ key: string } | null> {
  const boot = loadBootstrap();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (boot) {
    headers.set('New-API-User', String(boot.id));
    headers.set('X-Tenant-Id', String(boot.tenant_id));
  } else {
    headers.set('X-Tenant-Id', '1');
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { key?: string }; key?: string };
    const key = body.data?.key ?? body.key;
    return key ? { key } : null;
  } catch {
    return null;
  }
}

async function callImageGenerationWithReference(
  token: string,
  imageFile: File,
  prompt: string
): Promise<string> {
  const image = await fileToDataUrl(imageFile);

  const response = await fetch('/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image,
      model: imageModel,
      n: 1,
      prompt,
      size: imageSize,
    }),
  });

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(`gpt-image-2 报告生成失败：${detail}`);
  }

  return parseImageResponse(await response.json());
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取上传图片失败，请重新选择照片'));
    reader.readAsDataURL(file);
  });
}

function parseImageResponse(body: unknown): string {
  const data = (body as { data?: Array<{ url?: string; b64_json?: string }> }).data;
  const first = data?.[0];
  if (first?.url) return first.url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;
  throw new Error('图像接口返回异常：缺少 url 或 b64_json');
}

function buildPosterPrompt(styleGoal: ImageDiagnosisStyleGoal) {
  const goal = goalText[styleGoal];
  const brief = goalBrief[styleGoal];

  return `基于用户上传的人物照片，直接生成一张完整的中文竖版「个人穿搭分析」商业报告海报。

目标风格：${goal}
目标说明：${brief}

请参考案例版式，但不要照抄案例人物和文字：
1. 画布为手机长图海报，竖版，白色/米白底，精致杂志排版，适合小程序分享卡片与保存。
2. 顶部大标题必须是「个人穿搭分析」，副标题「找到更适合自己的风格 / PERSONAL STYLE ANALYSIS」。
3. 顶部右侧放 5 个圆角关键词标签，围绕用户照片提炼，例如「清冷」「甜酷」「高级」「松弛」「时尚」。
4. 主视觉区域做左右 VS：
   - 左侧是用户当前风格分析，标题类似「当前风格」或更具体的风格名。
   - 右侧是建议后的目标风格，标题必须贴合「${goal}」。
   - 两侧都用同一位用户的形象，尽量保持脸型、五官比例、年龄感、性别表达和发量观感一致。
   - 右侧要体现建议后的妆发、服饰、配色和气质提升。
5. 下方按双栏报告继续排版，必须包含这些模块：
   - 穿搭示例：每栏 4-5 个小图，展示上衣、裤裙、套装或外套。
   - 色彩推荐：推荐色/可选色/不推荐色，用圆形色卡和中文色名展示。
   - 配饰推荐：项链、耳饰、包、鞋或手表等小图。
   - 适合场合：通勤、约会、聚会、旅行、拍照等场景小图。
   - 风格总结：优点、劣势、关键词、搭配建议，用短句列点。
6. 海报内容要像付费报告，文字清晰、中文无乱码、字号可读，不要出现英文乱字、错别字、水印、logo。
7. 风格要高级、干净、商业化，有真实小红书/穿搭报告质感；不要卡通，不要低清截图，不要过度磨皮。
8. 不要只生成普通人像照，必须是一整张包含图片、色卡、中文分析文字和模块分区的报告海报。`;
}

async function safeReadError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
