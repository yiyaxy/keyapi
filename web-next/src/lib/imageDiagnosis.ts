import { loadBootstrap } from './bootstrap';

export type ImageDiagnosisAppType =
  | 'season_color'
  | 'makeup'
  | 'hairstyle'
  | 'hair_color'
  | 'accessories'
  | 'outfit'
  | 'glasses'
  | 'style_vs';

export type ImageDiagnosisStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type ImageDiagnosisResolution = 'standard' | 'high' | 'ultra' | 'auto';
export type ImageDiagnosisGenerationMode = 'async';

export interface ImageDiagnosisGenerationSettings {
  resolution: ImageDiagnosisResolution;
  mode: ImageDiagnosisGenerationMode;
}

export interface ImageDiagnosisAppConfig {
  type: ImageDiagnosisAppType;
  title: string;
  subtitle: string;
  tag: string;
  description: string;
  optionLabel: string;
  options: Array<{
    value: string;
    title: string;
    desc: string;
    prompt: string;
  }>;
  audience: string[];
  outputs: string[];
  promptFocus: string[];
  resultLayout: string[];
}

export interface ImageDiagnosisCreateInput {
  appType: ImageDiagnosisAppType;
  imageFile: File;
  imageUrl: string;
  option: string;
  settings: ImageDiagnosisGenerationSettings;
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
    appType?: ImageDiagnosisAppType;
    status: ImageDiagnosisStatus;
    progress: number;
    reportId?: string;
    message?: string;
  };
}

export interface ImageDiagnosisReport {
  id: string;
  appType: ImageDiagnosisAppType;
  appTitle: string;
  imageUrl: string;
  posterUrl: string;
  option: string;
  optionLabel: string;
  model: string;
  prompt: string;
  createdAt: number;
  settings: ImageDiagnosisGenerationSettings;
}

export interface ImageDiagnosisRecord {
  taskId: string;
  upstreamTaskId?: string;
  reportId: string;
  appType: ImageDiagnosisAppType;
  appTitle: string;
  optionLabel: string;
  status: ImageDiagnosisStatus;
  progress: number;
  message: string;
  createdAt: number;
  posterUrl?: string;
}

interface LocalTask {
  taskId: string;
  upstreamTaskId?: string;
  reportId: string;
  appType: ImageDiagnosisAppType;
  option: string;
  progress: number;
  status: ImageDiagnosisStatus;
  message: string;
  createdAt: number;
  settings: ImageDiagnosisGenerationSettings;
}

const localTasks = new Map<string, LocalTask>();
const localReports = new Map<string, ImageDiagnosisReport>();
const remoteReports = new Map<string, ImageDiagnosisReport>();
let remoteRecords: ImageDiagnosisRecord[] = [];

const appSlug = import.meta.env.VITE_IMAGE_DIAGNOSIS_APP_SLUG ?? 'image-diagnosis';
const imageModel = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_MODEL ?? 'gpt-image-2';
const imageSize = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_SIZE ?? '1536x2048';
const imageUltraSize = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_ULTRA_SIZE ?? '2160x3840';
const imageFallbackSize = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_FALLBACK_SIZE ?? '1024x1536';
const imageQuality = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_QUALITY ?? 'high';
const imageOutputFormat = import.meta.env.VITE_IMAGE_DIAGNOSIS_IMAGE_OUTPUT_FORMAT ?? 'png';
const historyStorageKey = 'image-diagnosis-history';
const historyRetentionMs = 72 * 60 * 60 * 1000;
// Local debug only. Paste a real sk- key here temporarily, or set
// localStorage.setItem('image-diagnosis-debug-token', 'sk-...')
const localDebugToken = '';

const resolutionPresets: Record<
  ImageDiagnosisResolution,
  { label: string; desc: string; size: string; fallbackSize: string; quality: string }
> = {
  standard: {
    label: '标准竖版',
    desc: '1024x1536，速度更稳，适合快速预览',
    size: imageFallbackSize,
    fallbackSize: '1024x1536',
    quality: 'medium',
  },
  high: {
    label: '2K 高清',
    desc: '1536x2048，细节更好，但生成更慢',
    size: imageSize,
    fallbackSize: imageFallbackSize,
    quality: imageQuality,
  },
  ultra: {
    label: '4K 超清',
    desc: '2160x3840，适合正式交付，生成最慢',
    size: imageUltraSize,
    fallbackSize: imageSize,
    quality: imageQuality,
  },
  auto: {
    label: '兼容模式',
    desc: '交给上游自动选择，最快但可能不是竖版',
    size: 'auto',
    fallbackSize: imageFallbackSize,
    quality: 'medium',
  },
};

export const imageDiagnosisResolutionOptions = Object.entries(resolutionPresets).map(
  ([value, preset]) => ({
    value: value as ImageDiagnosisResolution,
    label: preset.label,
    desc: preset.desc,
  })
);

export const defaultImageDiagnosisSettings: ImageDiagnosisGenerationSettings = {
  resolution: 'standard',
  mode: 'async',
};

export const imageDiagnosisApps: ImageDiagnosisAppConfig[] = [
  {
    type: 'season_color',
    title: '四季色彩诊断',
    subtitle: '找到真正适合你的颜色',
    tag: 'P0',
    description: '分析肤色、发色、瞳色、明度、饱和度和对比度，输出季型、推荐色卡和避雷色卡。',
    optionLabel: '使用场景',
    options: [
      {
        value: 'daily',
        title: '日常显气色',
        desc: '适合生活照和日常穿搭',
        prompt: '优先给出日常衣橱里好买、好搭、显气色的色彩组合。',
      },
      {
        value: 'commute',
        title: '通勤稳妥',
        desc: '偏实穿、低出错率',
        prompt: '强调办公室、会议、通勤都稳定的低出错率配色。',
      },
      {
        value: 'makeup',
        title: '妆容配色',
        desc: '口红、腮红、眼影怎么选',
        prompt: '重点输出适合底妆、眼影、腮红、口红的颜色范围。',
      },
      {
        value: 'shopping',
        title: '买衣避雷',
        desc: '减少买错颜色',
        prompt: '把推荐色和避雷色做成购物参考，标注可大面积使用和只能点缀的颜色。',
      },
      {
        value: 'photo',
        title: '拍照上镜',
        desc: '强调镜头表现力',
        prompt: '强调镜头前更显白、显精神、背景不抢脸的色彩。',
      },
    ],
    audience: ['想知道自己冷暖色的人', '经常买错衣服颜色的人', '需要口红/腮红配色参考的人'],
    outputs: ['季型倾向', '冷暖/明度/饱和度/对比度', '推荐色卡', '避雷色卡', '穿搭与妆容用色'],
    promptFocus: ['肤色冷暖', '发色瞳色', '面部对比度', '色彩明度', '大面积用色风险'],
    resultLayout: ['你的色彩类型', '色彩特征分析', '推荐色卡', '避雷色卡', '穿搭颜色', '妆容颜色', '一句话总结'],
  },
  {
    type: 'outfit',
    title: '穿搭风格诊断',
    subtitle: '找到适合你的穿衣风格',
    tag: 'P0',
    description: '分析整体气质和色彩倾向，输出风格关键词、推荐单品、面料、色系和场景搭配。',
    optionLabel: '穿搭场景',
    options: [
      {
        value: 'daily',
        title: '日常变美',
        desc: '自然耐看、生活感强',
        prompt: '推荐日常出门、逛街、自拍都自然耐看的穿搭，不要过度隆重。',
      },
      {
        value: 'commute',
        title: '通勤显气质',
        desc: '干净利落、有精神',
        prompt: '强调通勤、办公室、轻商务的利落感和可信赖气质。',
      },
      {
        value: 'date',
        title: '约会氛围感',
        desc: '柔和松弛、上镜',
        prompt: '强调柔和、亲近感、上镜和细节精致度。',
      },
      {
        value: 'business',
        title: '商务专业感',
        desc: '可信赖、有质感',
        prompt: '强调正式商务、客户沟通、会议场景下的专业度和质感。',
      },
      {
        value: 'travel_photo',
        title: '旅行拍照',
        desc: '出片、轻松、有记忆点',
        prompt: '强调旅拍出片、背景适配、行动舒适和风格记忆点。',
      },
    ],
    audience: ['不知道自己适合什么风格的人', '想提升通勤/约会形象的人', '衣柜单品很多但不好搭的人'],
    outputs: ['风格关键词', '推荐主色/辅助色', '推荐单品', '面料和廓形', '场景穿搭', '穿搭避雷'],
    promptFocus: ['整体气质', '身形和头身比例观感', '五官量感', '色彩倾向', '场景实穿性'],
    resultLayout: ['穿搭风格结论', '适合你的关键词', '推荐色系', '推荐单品', '场景穿搭建议', '穿搭避雷'],
  },
  {
    type: 'makeup',
    title: '妆容诊断看板',
    subtitle: '眉眼唇腮红怎么选',
    tag: 'P1',
    description: '分析肤色、五官量感和风格气质，给出底妆、眉色、眼影、腮红、口红建议。',
    optionLabel: '妆容方向',
    options: [
      {
        value: 'daily',
        title: '日常自然妆',
        desc: '低负担、提气色',
        prompt: '妆感要轻、自然、容易执行，突出气色而不是浓妆改造。',
      },
      {
        value: 'commute',
        title: '通勤妆',
        desc: '清爽、可信赖',
        prompt: '强调干净底妆、眉眼精神度和低饱和唇腮色。',
      },
      {
        value: 'dating',
        title: '约会妆',
        desc: '柔和、氛围感',
        prompt: '强调柔和亲近感、眼神亮度和自然上镜的唇腮搭配。',
      },
      {
        value: 'workplace',
        title: '职场妆',
        desc: '利落、有精神',
        prompt: '强调职业可信赖、轮廓清晰、不过度甜美或浓艳。',
      },
      {
        value: 'camera',
        title: '拍照上镜妆',
        desc: '镜头里更有神',
        prompt: '强调镜头吃妆问题，适当提升对比度、立体度和唇色存在感。',
      },
    ],
    audience: ['不会选口红腮红的人', '觉得妆后不如素颜自然的人', '需要通勤或约会妆容方向的人'],
    outputs: ['妆容风格结论', '底妆建议', '眉色/眉形', '眼影/眼线', '腮红/口红', '妆容避雷'],
    promptFocus: ['肤色冷暖', '五官量感', '眼唇存在感', '面部留白', '妆容浓淡平衡'],
    resultLayout: ['妆容风格结论', '眉眼唇腮红看板', '推荐色系', '妆容避雷', '3 个快速调整建议'],
  },
  {
    type: 'hairstyle',
    title: '发型诊断看板',
    subtitle: '判断长度、刘海和卷度',
    tag: 'P1',
    description: '分析脸型、面部线条和五官量感，输出适合发型、刘海、长度、卷度和避雷方向。',
    optionLabel: '长度偏好',
    options: [
      {
        value: 'no_preference',
        title: '不限制长度',
        desc: '让 AI 按脸型判断',
        prompt: '不预设长度，按脸型、线条、发量和气质判断最适合方向。',
      },
      {
        value: 'short',
        title: '短发方向',
        desc: '清爽利落、减龄',
        prompt: '在短发范围内推荐长度、层次、刘海和避雷短发轮廓。',
      },
      {
        value: 'medium',
        title: '锁骨发/中发',
        desc: '修饰脸型、易打理',
        prompt: '重点推荐锁骨发、中发层次、刘海和自然卷度。',
      },
      {
        value: 'long',
        title: '中长发/长发',
        desc: '保留温柔感',
        prompt: '在中长发范围内推荐层次、发尾、卷度和头顶蓬松度。',
      },
      {
        value: 'bangs',
        title: '刘海重点',
        desc: '判断要不要刘海',
        prompt: '重点判断是否适合刘海、刘海类型、长度和避雷厚重感。',
      },
      {
        value: 'easy_care',
        title: '低打理成本',
        desc: '适合懒人和通勤',
        prompt: '优先推荐低维护、日常吹干也能成立的发型方案。',
      },
    ],
    audience: ['想换发型但怕踩雷的人', '纠结刘海和长度的人', '发量/脸型修饰需求明显的人'],
    outputs: ['脸型与线条分析', '长度建议', '刘海建议', '卷度建议', '发型示例', '避雷发型'],
    promptFocus: ['脸型轮廓', '颧骨/下颌线观感', '五官量感', '发量和头顶高度', '日常打理成本'],
    resultLayout: ['脸型与线条分析', '适合发型方向', '刘海建议', '长度建议', '卷度建议', '不建议的发型'],
  },
  {
    type: 'hair_color',
    title: '发色诊断',
    subtitle: '找到显白又适合气质的发色',
    tag: 'P1',
    description: '判断适合的发色冷暖、深浅和具体色系，给出显白优先选择和染发避雷。',
    optionLabel: '发色目标',
    options: [
      {
        value: 'natural',
        title: '自然低调',
        desc: '不夸张、好驾驭',
        prompt: '推荐接近自然发色但更显气色的安全色。',
      },
      {
        value: 'elegant',
        title: '轻熟高级',
        desc: '质感、显气质',
        prompt: '强调低饱和、质感、显发质好的高级发色。',
      },
      {
        value: 'bright',
        title: '显白提亮',
        desc: '更有存在感',
        prompt: '在不违和的前提下，提高肤色明亮感和发色存在感。',
      },
      {
        value: 'workplace',
        title: '职场友好',
        desc: '稳妥、专业',
        prompt: '推荐职场可接受、低调但不沉闷的发色。',
      },
      {
        value: 'first_dye',
        title: '第一次染发',
        desc: '保守、低翻车率',
        prompt: '优先推荐低维护、褪色后也自然的初染方案。',
      },
    ],
    audience: ['想染发但怕显黑的人', '第一次染发的人', '需要职场友好发色的人'],
    outputs: ['发色方向结论', '冷暖深浅', '推荐发色', '显白优先选择', '避雷发色', '染发前注意事项'],
    promptFocus: ['肤色冷暖', '面部明度', '原生发色', '气质成熟度', '褪色维护成本'],
    resultLayout: ['发色方向结论', '推荐发色列表', '显白优先选择', '不建议发色', '染发前注意事项'],
  },
  {
    type: 'glasses',
    title: '眼镜诊断',
    subtitle: '判断适合你的框型和颜色',
    tag: 'P1',
    description: '分析脸型、眉眼距离和五官线条，输出适合框型、材质、大小和避雷框型。',
    optionLabel: '佩戴场景',
    options: [
      {
        value: 'daily',
        title: '日常佩戴',
        desc: '舒服自然',
        prompt: '推荐舒适、耐看、不压五官的日常镜框。',
      },
      {
        value: 'work',
        title: '工作通勤',
        desc: '清爽专业',
        prompt: '强调清爽专业、可信赖和长期佩戴不过时。',
      },
      {
        value: 'study',
        title: '学习办公',
        desc: '轻量耐看',
        prompt: '强调轻量、耐看、长时间佩戴舒适。',
      },
      {
        value: 'fashion',
        title: '造型搭配',
        desc: '强化风格',
        prompt: '允许更有风格感，但不能压低五官和脸型优势。',
      },
      {
        value: 'screen',
        title: '上镜/视频',
        desc: '视频会议更精神',
        prompt: '重点考虑视频会议、自拍、镜头反光和眼神清晰度。',
      },
    ],
    audience: ['准备配眼镜的人', '戴眼镜显呆或压脸的人', '想用眼镜增强风格的人'],
    outputs: ['眼镜适配结论', '脸型与框型关系', '推荐框型', '推荐颜色', '推荐材质', '避雷框型'],
    promptFocus: ['脸型宽窄', '眉眼距离', '鼻梁和中庭观感', '五官线条', '镜框存在感'],
    resultLayout: ['眼镜适配结论', '脸型与框型关系', '推荐框型', '推荐颜色', '推荐材质', '不建议框型'],
  },
  {
    type: 'accessories',
    title: '饰品建议',
    subtitle: '金饰、银饰、珍珠怎么选',
    tag: 'P1',
    description: '分析脸型、五官量感和风格气质，给出金属色、材质、大小和饰品类型建议。',
    optionLabel: '佩戴场合',
    options: [
      {
        value: 'daily',
        title: '日常精致',
        desc: '轻量、耐看',
        prompt: '推荐日常小体量、能提升精致度但不夸张的饰品。',
      },
      {
        value: 'workplace',
        title: '职场通勤',
        desc: '低调、有质感',
        prompt: '强调低调质感、专业可信赖，不要过度华丽。',
      },
      {
        value: 'date',
        title: '约会聚会',
        desc: '柔和、上镜',
        prompt: '强调柔和氛围、近距离好看和拍照细节。',
      },
      {
        value: 'formal',
        title: '正式场合',
        desc: '更有仪式感',
        prompt: '强调礼服、宴会、正式拍摄场景的仪式感和质感。',
      },
      {
        value: 'minimal',
        title: '极简通用',
        desc: '少买但好搭',
        prompt: '推荐少量高复用饰品，覆盖大多数日常和通勤场景。',
      },
    ],
    audience: ['不知道戴金还是戴银的人', '饰品一戴就显土/显夸张的人', '想提升精致感的人'],
    outputs: ['金属色建议', '饰品大小', '材质建议', '耳饰建议', '项链建议', '避雷饰品'],
    promptFocus: ['脸型线条', '五官量感', '肤色冷暖', '脖颈和肩颈观感', '风格精致度'],
    resultLayout: ['饰品风格结论', '金/银/玫瑰金建议', '珍珠/金属/几何材质', '大小和存在感', '不建议佩戴类型'],
  },
  {
    type: 'style_vs',
    title: 'VS 风格对比',
    subtitle: '生成风格对比与穿搭海报',
    tag: '热门',
    description: '独立生成视觉冲击更强的 VS 对比海报，包含建议后形象、穿搭示例、色卡和场景建议。',
    optionLabel: '对比方向',
    options: [
      {
        value: 'current_recommended',
        title: '当前风格 VS 推荐风格',
        desc: '最通用的优化对比',
        prompt: '左侧呈现当前风格，右侧呈现更适合的综合推荐风格。',
      },
      {
        value: 'ordinary_refined',
        title: '普通穿搭 VS 显气质穿搭',
        desc: '适合营销分享',
        prompt: '强化普通感到精致感的变化，但不要夸张贬低左侧。',
      },
      {
        value: 'passerby_atmosphere',
        title: '路人感 VS 氛围感',
        desc: '强化视觉变化',
        prompt: '强调氛围、发型、色彩、构图和穿搭精致度的提升。',
      },
      {
        value: 'casual_commute',
        title: '随意搭配 VS 精致通勤',
        desc: '适合职场场景',
        prompt: '左侧随意休闲，右侧精致通勤，体现职场可用性。',
      },
      {
        value: 'saturation',
        title: '高饱和 VS 低饱和',
        desc: '适合色彩对比',
        prompt: '重点展示高饱和颜色与低饱和高级配色对脸部气质的影响。',
      },
      {
        value: 'sweet_elegant',
        title: '甜美风 VS 轻熟风',
        desc: '适合风格测试',
        prompt: '左侧甜美，右侧轻熟高级，保持同一人物识别感。',
      },
    ],
    audience: ['想看到建议后形象的人', '需要分享海报的人', '想做风格变化对比的人'],
    outputs: ['VS 对比海报', '建议后形象', '穿搭示例', '适合色卡', '场景建议', '一句话风格建议'],
    promptFocus: ['当前风格问题', '目标风格变化', '妆发服饰配色', '视觉冲击', '分享海报完整度'],
    resultLayout: ['左右 VS 主视觉', '穿搭示例', '色彩推荐', '配饰推荐', '适合场合', '风格总结'],
  },
];

export function getImageDiagnosisApp(type: ImageDiagnosisAppType) {
  return imageDiagnosisApps.find((app) => app.type === type) ?? imageDiagnosisApps[0];
}

export function getImageDiagnosisAppLabel(type: ImageDiagnosisAppType) {
  return getImageDiagnosisApp(type).title;
}

export function getImageDiagnosisOptionLabel(type: ImageDiagnosisAppType, option: string) {
  const app = getImageDiagnosisApp(type);
  return app.options.find((item) => item.value === option)?.title ?? app.options[0]?.title ?? '';
}

export function getImageDiagnosisResolutionLabel(resolution: ImageDiagnosisResolution) {
  return resolutionPresets[resolution]?.label ?? resolutionPresets.standard.label;
}

function getImageDiagnosisOption(type: ImageDiagnosisAppType, option: string) {
  const app = getImageDiagnosisApp(type);
  return app.options.find((item) => item.value === option) ?? app.options[0];
}

export async function createImageDiagnosisTask(
  input: ImageDiagnosisCreateInput
): Promise<ImageDiagnosisCreateResult> {
  const taskId = `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const reportId = taskId.replace('diag_', 'report_');
  const app = getImageDiagnosisApp(input.appType);
  const optionLabel = getImageDiagnosisOptionLabel(input.appType, input.option);
  const settings = normalizeSettings(input.settings);
  const createdAt = Date.now();

  localTasks.set(taskId, {
    taskId,
    reportId,
    appType: input.appType,
    option: input.option,
    progress: 3,
    status: 'pending',
    message: `准备生成${app.title}报告`,
    createdAt,
    settings,
  });

  void saveImageDiagnosisRemoteRecord({
    resultId: reportId,
    taskId,
    appType: input.appType,
    appTitle: app.title,
    imageUrl: input.imageUrl,
    option: input.option,
    optionLabel,
    model: imageModel,
    settings,
    createdAt,
    status: 'pending',
    progress: 3,
    message: `准备生成${app.title}报告`,
  });

  void runPosterGeneration(taskId, { ...input, settings });

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
    const remoteRecord = remoteRecords.find((item) => item.taskId === taskId);
    if (remoteRecord) {
      return {
        code: 0,
        data: {
          taskId,
          appType: remoteRecord.appType,
          status: remoteRecord.status,
          progress: remoteRecord.progress,
          reportId: remoteRecord.status === 'succeeded' ? remoteRecord.reportId : undefined,
          message: remoteRecord.message,
        },
      };
    }
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
      appType: task.appType,
      status: task.status,
      progress: task.progress,
      reportId: task.status === 'succeeded' ? task.reportId : undefined,
      message: task.message,
    },
  };
}

export async function getImageDiagnosisReport(reportId: string): Promise<ImageDiagnosisReport> {
  const report = findImageDiagnosisReport(reportId);
  if (report) return report;
  const remoteReport = await fetchRemoteImageDiagnosisReport(reportId);
  if (remoteReport) return remoteReport;
  throw new Error('报告不存在或已超过 72 小时保留期，请重新生成');
}

export function findImageDiagnosisReport(reportId: string): ImageDiagnosisReport | null {
  return (
    localReports.get(reportId) ??
    remoteReports.get(reportId) ??
    getStoredReports().find((item) => item.id === reportId) ??
    null
  );
}

export function listImageDiagnosisRecords(): ImageDiagnosisRecord[] {
  const taskRecords = Array.from(localTasks.values()).map((task) => {
    const report = localReports.get(task.reportId);
    return taskToRecord(task, report);
  });
  const taskReportIds = new Set(taskRecords.map((item) => item.reportId));
  const visibleRemoteRecords = remoteRecords.filter((record) => !taskReportIds.has(record.reportId));
  const remoteReportIds = new Set(visibleRemoteRecords.map((item) => item.reportId));
  const storedRecords = getStoredReports()
    .filter((report) => !taskReportIds.has(report.id) && !remoteReportIds.has(report.id))
    .map((report) => reportToRecord(report));
  return mergeUniqueRecords([...taskRecords, ...visibleRemoteRecords, ...storedRecords]);
}

export async function refreshImageDiagnosisRecords(): Promise<ImageDiagnosisRecord[]> {
  await fetchRemoteImageDiagnosisRecords();
  return listImageDiagnosisRecords();
}

function normalizeSettings(
  settings?: Partial<ImageDiagnosisGenerationSettings>
): ImageDiagnosisGenerationSettings {
  const resolution = settings?.resolution ?? defaultImageDiagnosisSettings.resolution;
  return {
    resolution: resolutionPresets[resolution] ? resolution : defaultImageDiagnosisSettings.resolution,
    mode: 'async',
  };
}

async function runPosterGeneration(taskId: string, input: ImageDiagnosisCreateInput) {
  const task = localTasks.get(taskId);
  if (!task) return;

  try {
    const app = getImageDiagnosisApp(input.appType);
    const optionLabel = getImageDiagnosisOptionLabel(input.appType, input.option);

    updateTask(taskId, 10, '获取应用调用凭证');
    const token = await resolveRelayToken();

    updateTask(taskId, 18, `提交 ${imageModel} 异步生成任务`);
    const prompt = buildPosterPrompt(input.appType, input.option);
    await saveImageDiagnosisRemoteRecord({
      resultId: task.reportId,
      taskId: task.taskId,
      appType: input.appType,
      appTitle: app.title,
      imageUrl: input.imageUrl,
      option: input.option,
      optionLabel,
      model: imageModel,
      prompt,
      settings: input.settings,
      createdAt: task.createdAt,
      status: 'running',
      progress: 18,
      message: `提交 ${imageModel} 异步生成任务`,
    });

    const asyncTaskId = await submitAsyncImageGenerationWithReference(
      token,
      input.imageFile,
      prompt,
      input.settings.resolution
    );
    task.upstreamTaskId = asyncTaskId;
    updateTask(taskId, 35, '异步任务已提交，等待上游生成');
    await saveImageDiagnosisRemoteRecord({
      resultId: task.reportId,
      taskId: task.taskId,
      upstreamTaskId: asyncTaskId,
      appType: input.appType,
      appTitle: app.title,
      imageUrl: input.imageUrl,
      option: input.option,
      optionLabel,
      model: imageModel,
      prompt,
      settings: input.settings,
      createdAt: task.createdAt,
      status: 'running',
      progress: 35,
      message: '异步任务已提交，等待上游生成',
    });

    const posterUrl = await waitForAsyncImageResult(token, asyncTaskId, (progress, message) => {
      updateTask(taskId, progress, message);
      void saveImageDiagnosisRemoteRecord({
        resultId: task.reportId,
        taskId: task.taskId,
        upstreamTaskId: asyncTaskId,
        appType: input.appType,
        appTitle: app.title,
        imageUrl: input.imageUrl,
        option: input.option,
        optionLabel,
        model: imageModel,
        prompt,
        settings: input.settings,
        createdAt: task.createdAt,
        status: 'running',
        progress,
        message,
      });
    });

    updateTask(taskId, 96, '整理报告图片');
    const report: ImageDiagnosisReport = {
      id: task.reportId,
      appType: input.appType,
      appTitle: app.title,
      imageUrl: input.imageUrl,
      posterUrl,
      option: input.option,
      optionLabel,
      model: imageModel,
      prompt,
      createdAt: task.createdAt,
      settings: input.settings,
    };

    task.status = 'succeeded';
    task.progress = 100;
    task.message = '报告海报已生成';
    localReports.set(task.reportId, report);
    saveReportToHistory(report);
    void saveImageDiagnosisRemoteRecord({
      resultId: report.id,
      taskId: task.taskId,
      upstreamTaskId: task.upstreamTaskId,
      appType: report.appType,
      appTitle: report.appTitle,
      imageUrl: report.imageUrl,
      posterUrl: report.posterUrl,
      option: report.option,
      optionLabel: report.optionLabel,
      model: report.model,
      prompt: report.prompt,
      settings: report.settings,
      createdAt: report.createdAt,
      status: 'succeeded',
      progress: 100,
      message: '报告海报已生成',
    });
  } catch (error) {
    task.status = 'failed';
    task.progress = Math.max(task.progress, 12);
    task.message =
      error instanceof Error ? error.message : '报告海报生成失败，请稍后重试或更换照片';
    void saveImageDiagnosisRemoteRecord({
      resultId: task.reportId,
      taskId: task.taskId,
      upstreamTaskId: task.upstreamTaskId,
      appType: task.appType,
      appTitle: getImageDiagnosisApp(task.appType).title,
      option: task.option,
      optionLabel: getImageDiagnosisOptionLabel(task.appType, task.option),
      model: imageModel,
      settings: task.settings,
      createdAt: task.createdAt,
      status: 'failed',
      progress: task.progress,
      message: task.message,
    });
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

function getAppHeaders() {
  const boot = loadBootstrap();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (boot) {
    headers.set('New-API-User', String(boot.id));
    headers.set('X-Tenant-Id', String(boot.tenant_id));
  } else {
    headers.set('X-Tenant-Id', '1');
  }
  return headers;
}

function getHistoryOwnerKey() {
  const boot = loadBootstrap();
  if (boot) return `user:${boot.tenant_id}:${boot.id}`;

  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get('token') || params.get('key');
  if (import.meta.env.DEV && urlToken === 'sk-preview') return 'debug:sk-preview';
  if (urlToken) return `token:${hashText(urlToken)}`;

  const debugToken = getLocalDebugToken();
  if (debugToken) return `token:${hashText(debugToken)}`;

  const guestKey = 'image-diagnosis-guest-owner';
  const existing = window.localStorage.getItem(guestKey);
  if (existing) return `guest:${existing}`;
  const next = `guest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  window.localStorage.setItem(guestKey, next);
  return `guest:${next}`;
}

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function requestAppSession(url: string): Promise<{ key: string } | null> {
  const headers = getAppHeaders();

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

async function submitAsyncImageGenerationWithReference(
  token: string,
  imageFile: File,
  prompt: string,
  resolution: ImageDiagnosisResolution
): Promise<string> {
  const image = await fileToDataUrl(imageFile);
  const preset = resolutionPresets[resolution] ?? resolutionPresets.standard;
  const body = {
    image,
    images: [image],
    model: imageModel,
    n: 1,
    output_format: imageOutputFormat,
    prompt,
    quality: preset.quality,
  };

  const response = await requestImageGeneration(token, {
    ...body,
    size: preset.size,
  });

  if (!response.ok && preset.fallbackSize && preset.fallbackSize !== preset.size) {
    const detail = await safeReadError(response);
    if (isUnsupportedImageSizeError(detail)) {
      const fallbackResponse = await requestImageGeneration(token, {
        ...body,
        size: preset.fallbackSize,
      });
      if (!fallbackResponse.ok) {
        const fallbackDetail = await safeReadError(fallbackResponse);
        throw new Error(`gpt-image-2 异步任务提交失败：${fallbackDetail}`);
      }
      return parseAsyncSubmitResponse(await fallbackResponse.json());
    }
    throw new Error(`gpt-image-2 异步任务提交失败：${detail}`);
  }

  if (!response.ok) {
    const detail = await safeReadError(response);
    throw new Error(`gpt-image-2 异步任务提交失败：${detail}`);
  }

  return parseAsyncSubmitResponse(await response.json());
}

function requestImageGeneration(
  token: string,
  body: {
    image: string;
    images: string[];
    model: string;
    n: number;
    output_format: string;
    prompt: string;
    quality: string;
    size: string;
  }
) {
  return fetch('/v1/images/async', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function waitForAsyncImageResult(
  token: string,
  upstreamTaskId: string,
  onProgress: (progress: number, message: string) => void
) {
  const startedAt = Date.now();
  const timeoutMs = 18 * 60 * 1000;
  let delayMs = 2500;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(delayMs);
    const response = await fetch(`/v1/images/async/${encodeURIComponent(upstreamTaskId)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const detail = await safeReadError(response);
      throw new Error(`异步图片任务查询失败：${detail}`);
    }
    const body = (await response.json()) as AsyncImageTaskResponse;
    const status = normalizeAsyncStatus(body.status);
    const progress = normalizeAsyncProgress(body.progress, status);
    onProgress(progress, getAsyncStatusMessage(status));

    if (status === 'succeeded') {
      if (!body.result) throw new Error('异步图片任务已完成，但结果为空');
      return parseImageResponse(body.result);
    }
    if (status === 'failed') {
      throw new Error(body.error?.message || '异步图片任务生成失败');
    }
    delayMs = Math.min(6000, Math.round(delayMs * 1.15));
  }
  throw new Error('异步图片任务等待超时，请稍后在历史记录中查看');
}

function parseAsyncSubmitResponse(body: unknown) {
  const taskId =
    (body as { task_id?: string }).task_id ??
    (body as { data?: { task_id?: string } }).data?.task_id ??
    (body as { data?: Array<{ task_id?: string }> }).data?.[0]?.task_id;
  if (!taskId) throw new Error('异步图片接口返回异常：缺少 task_id');
  return taskId;
}

interface AsyncImageTaskResponse {
  task_id?: string;
  status?: string;
  progress?: number | string;
  result?: unknown;
  error?: {
    message?: string;
    code?: string;
  } | null;
}

function normalizeAsyncStatus(status?: string): ImageDiagnosisStatus | 'queued' {
  const value = String(status || '').toLowerCase();
  if (['succeeded', 'success', 'completed', 'complete'].includes(value)) return 'succeeded';
  if (['failed', 'failure', 'error'].includes(value)) return 'failed';
  if (['processing', 'running', 'in_progress'].includes(value)) return 'running';
  return 'queued';
}

function normalizeAsyncProgress(
  progress: AsyncImageTaskResponse['progress'],
  status: ImageDiagnosisStatus | 'queued'
) {
  if (status === 'succeeded') return 100;
  if (status === 'failed') return 100;
  if (typeof progress === 'number' && Number.isFinite(progress)) return Math.max(35, Math.min(95, progress));
  if (typeof progress === 'string') {
    const parsed = Number.parseInt(progress.replace('%', ''), 10);
    if (Number.isFinite(parsed)) return Math.max(35, Math.min(95, parsed));
  }
  return status === 'queued' ? 40 : 68;
}

function getAsyncStatusMessage(status: ImageDiagnosisStatus | 'queued') {
  if (status === 'queued') return '任务排队中，等待上游开始生成';
  if (status === 'running') return '高清海报生成中，请耐心等待';
  if (status === 'succeeded') return '报告海报已生成';
  return '报告海报生成失败';
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isUnsupportedImageSizeError(message: string) {
  return /size|尺寸|分辨率|unsupported|invalid|not support/i.test(message);
}

function taskToRecord(task: LocalTask, report?: ImageDiagnosisReport): ImageDiagnosisRecord {
  const app = getImageDiagnosisApp(task.appType);
  return {
    taskId: task.taskId,
    upstreamTaskId: task.upstreamTaskId,
    reportId: task.reportId,
    appType: task.appType,
    appTitle: app.title,
    optionLabel: getImageDiagnosisOptionLabel(task.appType, task.option),
    status: task.status,
    progress: task.progress,
    message: task.message,
    createdAt: task.createdAt,
    posterUrl: report?.posterUrl,
  };
}

function reportToRecord(report: ImageDiagnosisReport): ImageDiagnosisRecord {
  return {
    taskId: report.id.replace('report_', 'diag_'),
    reportId: report.id,
    appType: report.appType,
    appTitle: report.appTitle,
    optionLabel: report.optionLabel,
    status: 'succeeded',
    progress: 100,
    message: '报告海报已生成',
    createdAt: report.createdAt,
    posterUrl: report.posterUrl,
  };
}

function mergeUniqueRecords(records: ImageDiagnosisRecord[]) {
  const seen = new Set<string>();
  return records
    .filter((record) => {
      const key = record.reportId || record.taskId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function fetchRemoteImageDiagnosisRecords() {
  const ownerKey = getHistoryOwnerKey();
  if (!ownerKey) return;
  try {
    const response = await fetch(
      `/api/app/image-diagnosis/results?ownerKey=${encodeURIComponent(ownerKey)}`,
      {
        headers: getAppHeaders(),
        credentials: 'include',
      }
    );
    if (!response.ok) return;
    const body = (await response.json()) as { data?: { items?: RemoteImageDiagnosisResult[] } };
    const items = body.data?.items ?? [];
    remoteRecords = items.map(remoteResultToRecord);
    items.forEach((item) => {
      const report = remoteResultToReport(item);
      if (report) remoteReports.set(report.id, report);
    });
  } catch {
    // Keep local history usable when the backend is not running in local dev.
  }
}

async function fetchRemoteImageDiagnosisReport(reportId: string) {
  const ownerKey = getHistoryOwnerKey();
  if (!ownerKey) return null;
  try {
    const response = await fetch(
      `/api/app/image-diagnosis/results/${encodeURIComponent(reportId)}?ownerKey=${encodeURIComponent(ownerKey)}`,
      {
        headers: getAppHeaders(),
        credentials: 'include',
      }
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: RemoteImageDiagnosisResult };
    const report = body.data ? remoteResultToReport(body.data) : null;
    if (report) {
      remoteReports.set(report.id, report);
      saveReportToHistory(report);
    }
    return report;
  } catch {
    return null;
  }
}

async function saveImageDiagnosisRemoteRecord(record: {
  resultId: string;
  taskId: string;
  upstreamTaskId?: string;
  appType: ImageDiagnosisAppType;
  appTitle: string;
  imageUrl?: string;
  posterUrl?: string;
  option: string;
  optionLabel: string;
  model: string;
  prompt?: string;
  settings: ImageDiagnosisGenerationSettings;
  createdAt: number;
  status: ImageDiagnosisStatus;
  progress: number;
  message: string;
}) {
  const ownerKey = getHistoryOwnerKey();
  if (!ownerKey) return;
  try {
    await fetch('/api/app/image-diagnosis/results', {
      method: 'POST',
      headers: getAppHeaders(),
      credentials: 'include',
      body: JSON.stringify({
        owner_key: ownerKey,
        result_id: record.resultId,
        task_id: record.taskId,
        upstream_task_id: record.upstreamTaskId,
        app_type: record.appType,
        app_title: record.appTitle,
        image_url: record.imageUrl ?? '',
        poster_url: record.posterUrl ?? '',
        status: record.status,
        progress: record.progress,
        message: record.message,
        option: record.option,
        option_label: record.optionLabel,
        model: record.model,
        prompt: record.prompt ?? '',
        settings: JSON.stringify(record.settings),
        created_at: record.createdAt,
      }),
    });
  } catch {
    // The browser-local copy is still available even if persistence fails.
  }
}

interface RemoteImageDiagnosisResult {
  result_id: string;
  task_id?: string;
  upstream_task_id?: string;
  app_type: ImageDiagnosisAppType;
  app_title?: string;
  image_url?: string;
  poster_url?: string;
  status?: ImageDiagnosisStatus;
  progress?: number;
  message?: string;
  option?: string;
  option_label?: string;
  model?: string;
  prompt?: string;
  settings?: string;
  created_at?: number;
}

function remoteResultToRecord(item: RemoteImageDiagnosisResult): ImageDiagnosisRecord {
  const app = getImageDiagnosisApp(item.app_type);
  const status = item.status ?? (item.poster_url ? 'succeeded' : 'running');
  return {
    taskId: item.task_id || item.result_id.replace('report_', 'diag_'),
    upstreamTaskId: item.upstream_task_id,
    reportId: item.result_id,
    appType: item.app_type,
    appTitle: item.app_title || app.title,
    optionLabel: item.option_label || getImageDiagnosisOptionLabel(item.app_type, item.option || ''),
    status,
    progress: item.progress ?? (status === 'succeeded' ? 100 : 35),
    message: item.message || (status === 'succeeded' ? '报告海报已生成' : '高清海报生成中'),
    createdAt: item.created_at || Date.now(),
    posterUrl: item.poster_url,
  };
}

function remoteResultToReport(item: RemoteImageDiagnosisResult): ImageDiagnosisReport | null {
  if (!item.poster_url) return null;
  const app = getImageDiagnosisApp(item.app_type);
  return {
    id: item.result_id,
    appType: item.app_type,
    appTitle: item.app_title || app.title,
    imageUrl: item.image_url || '',
    posterUrl: item.poster_url,
    option: item.option || app.options[0]?.value || '',
    optionLabel: item.option_label || getImageDiagnosisOptionLabel(item.app_type, item.option || ''),
    model: item.model || imageModel,
    prompt: item.prompt || '',
    createdAt: item.created_at || Date.now(),
    settings: parseStoredSettings(item.settings),
  };
}

function parseStoredSettings(settings?: string): ImageDiagnosisGenerationSettings {
  if (!settings) return defaultImageDiagnosisSettings;
  try {
    return normalizeSettings(JSON.parse(settings) as Partial<ImageDiagnosisGenerationSettings>);
  } catch {
    return defaultImageDiagnosisSettings;
  }
}

function getStoredReports(): ImageDiagnosisReport[] {
  try {
    const raw = window.localStorage.getItem(historyStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ImageDiagnosisReport[];
    if (!Array.isArray(parsed)) return [];
    const expiresAfter = Date.now() - historyRetentionMs;
    const valid = parsed.filter((item) => item.createdAt > expiresAfter);
    if (valid.length !== parsed.length) {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(valid));
    }
    return valid;
  } catch {
    return [];
  }
}

function saveReportToHistory(report: ImageDiagnosisReport) {
  try {
    const expiresAfter = Date.now() - historyRetentionMs;
    const next = [report, ...getStoredReports().filter((item) => item.id !== report.id)]
      .filter((item) => item.createdAt > expiresAfter)
      .slice(0, 20);
    window.localStorage.setItem(historyStorageKey, JSON.stringify(next));
  } catch {
    // Large data-url posters may exceed localStorage. Remote URLs still work and are persisted.
  }
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
  if (first?.url && !isLikelyPreviewUrl(first.url)) return first.url;
  if (first?.b64_json) return `data:image/png;base64,${first.b64_json}`;

  const urls = collectImageUrls(body);
  const bestUrl =
    urls.find((url) => !isLikelyPreviewUrl(url) && isLikelyFinalPosterUrl(url)) ??
    urls.find((url) => !isLikelyPreviewUrl(url)) ??
    urls[0];
  if (bestUrl) return bestUrl;
  if (first?.url) return first.url;
  throw new Error('图像接口返回异常：缺少 url 或 b64_json');
}

function collectImageUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    return /^https?:\/\/.+\.(png|jpe?g|webp)(\?.*)?$/i.test(value) ? [value] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectImageUrls(item));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).flatMap((item) => collectImageUrls(item));
  }
  return [];
}

function isLikelyPreviewUrl(url: string) {
  return /thumb|thumbnail|preview|small|low|compressed/i.test(url);
}

function isLikelyFinalPosterUrl(url: string) {
  return /gpt|image|poster|task|upload/i.test(url);
}

function buildPosterPrompt(appType: ImageDiagnosisAppType, option: string) {
  const app = getImageDiagnosisApp(appType);
  const selectedOption = getImageDiagnosisOption(appType, option);
  if (appType === 'style_vs') return buildStyleVsPrompt(app, selectedOption);
  return buildDiagnosisPrompt(app, selectedOption);
}

function buildDiagnosisPrompt(
  app: ImageDiagnosisAppConfig,
  selectedOption: ImageDiagnosisAppConfig['options'][number]
) {
  return `基于用户上传的人物照片，生成一张完整中文竖版「${app.title}」商业诊断报告海报。

子应用：${app.title}
诊断场景：${selectedOption.title}
场景说明：${selectedOption.desc}
场景生成重点：${selectedOption.prompt}
功能目标：${app.description}
重点分析维度：${app.promptFocus.join('、')}
必须输出模块：${app.resultLayout.join('、')}
报告里要覆盖的结果项：${app.outputs.join('、')}

画面和内容要求：
1. 画布为手机长图海报，竖版 3:4 或 4:5 构图，目标 2K 左右高清输出，优先按 1536x2048 像素质感设计；不要方图，不要低清截图感。
2. 顶部主标题必须是「${app.title}」，副标题用一句中文说明结论，不要使用无意义英文。
3. 必须以用户上传照片作为唯一人物参考，主视觉人物必须是同一个人；不要替换成网红脸、陌生模特或案例人物。尽量保留原照片的脸型、五官比例、发量、肤色明度、性别表达和整体识别感。
4. 海报必须包含：诊断结论、关键特征分析、推荐方案、避雷建议、快速调整建议、一句话总结。
5. 根据子应用类型生成专属模块：
   - 四季色彩诊断：季型结果、冷暖倾向、明度、饱和度、对比度、推荐色卡、避雷色卡、穿搭颜色、妆容颜色。
   - 妆容诊断看板：适合妆感、底妆、眉色、眼影、腮红、口红、避雷妆容、快速改造。
   - 发型诊断看板：脸型与线条、适合长度、刘海、卷度、发型示例、避雷发型。
   - 发色诊断：发色冷暖方向、深浅建议、显白发色、推荐发色、避雷发色、染发注意事项。
   - 饰品建议：金属色、饰品大小、材质、耳饰、项链、避雷饰品。
   - 穿搭风格诊断：风格关键词、推荐主色、辅助色、单品、面料、场景穿搭、穿搭避雷。
   - 眼镜诊断：是否适合戴眼镜、推荐框型、镜框颜色、材质、大小、避雷框型。
6. 使用清晰中文短句，语气专业温和，用「更适合」「建议」「倾向于」，不要评价颜值，不要判断身份、年龄、种族、健康状态。
7. 海报需要像付费报告：文字锐利可读、边缘清晰、模块分区清楚、有色卡/小图标/单品小图，不要乱码、错别字、水印、logo。
8. 不要只生成普通人像照，必须是一整张包含用户本人形象、色卡或推荐元素、中文分析文字和模块分区的报告海报。`;
}

function buildStyleVsPrompt(
  app: ImageDiagnosisAppConfig,
  selectedOption: ImageDiagnosisAppConfig['options'][number]
) {
  return `基于用户上传的人物照片，直接生成一张完整中文竖版「个人穿搭分析」VS 风格对比商业报告海报。

子应用：${app.title}
对比方向：${selectedOption.title}
对比说明：${selectedOption.desc}
对比生成重点：${selectedOption.prompt}
重点分析维度：${app.promptFocus.join('、')}
必须输出模块：${app.resultLayout.join('、')}

请参考小红书风格报告版式，但不要照抄案例人物和文字：
1. 画布为手机长图海报，竖版 3:4 或 4:5 构图，目标 2K 左右高清输出，优先按 1536x2048 像素质感设计；不要方图，不要低清截图感。
2. 顶部大标题必须是「个人穿搭分析」，副标题「找到更适合自己的风格」。
3. 顶部右侧放 5 个圆角关键词标签，围绕用户照片提炼，例如「清冷」「甜酷」「高级」「松弛」「时尚」。
4. 主视觉区域做左右 VS：
   - 左侧是用户当前风格分析，标题类似「当前风格」或更具体的风格名。
   - 右侧是建议后的目标风格，标题必须贴合「${selectedOption.title}」。
   - 两侧都必须使用用户上传照片里的同一位人物作为唯一参考，不要换成网红脸、陌生模特或案例人物；尽量保持脸型、五官比例、肤色明度、性别表达和发量观感一致。
   - 右侧要体现建议后的妆发、服饰、配色和气质提升。
5. 下方按双栏报告继续排版，必须包含这些模块：
   - 穿搭示例：每栏 4-5 个小图，展示上衣、裤裙、套装或外套。
   - 色彩推荐：推荐色/可选色/不推荐色，用圆形色卡和中文色名展示。
   - 配饰推荐：项链、耳饰、包、鞋或手表等小图。
   - 适合场合：通勤、约会、聚会、旅行、拍照等场景小图。
   - 风格总结：优点、劣势、关键词、搭配建议，用短句列点。
6. 海报内容要像付费报告，文字锐利清晰、中文无乱码、字号可读，不要出现英文乱字、错别字、水印、logo。
7. 风格要高级、干净、商业化，有真实穿搭报告质感；不要卡通，不要低清截图，不要过度磨皮。
8. 不要只生成普通人像照，必须是一整张包含用户本人图片、色卡、中文分析文字和模块分区的报告海报。`;
}

async function safeReadError(response: Response) {
  try {
    const body = (await response.json()) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
