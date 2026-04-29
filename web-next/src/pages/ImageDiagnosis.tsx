import { type ChangeEvent, type ComponentType, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Brush,
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  Gem,
  Glasses,
  ImagePlus,
  Loader2,
  Palette,
  RefreshCcw,
  Scissors,
  Shirt,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import {
  captureImageDiagnosisUrlToken,
  createImageDiagnosisTask,
  defaultImageDiagnosisSettings,
  findImageDiagnosisReport,
  getImageDiagnosisApp,
  getImageDiagnosisNavigationTokenParam,
  getImageDiagnosisOptionLabel,
  getImageDiagnosisReport,
  getImageDiagnosisResolutionLabel,
  getImageDiagnosisTask,
  hasImageDiagnosisDirectToken,
  imageDiagnosisResolutionOptions,
  imageDiagnosisApps,
  listImageDiagnosisRecords,
  refreshImageDiagnosisRecords,
  type ImageDiagnosisAppConfig,
  type ImageDiagnosisAppType,
  type ImageDiagnosisGenerationSettings,
  type ImageDiagnosisReport,
  type ImageDiagnosisRecord,
} from '@/lib/imageDiagnosis';
import { cn } from '@/lib/utils';

const appIcons: Record<ImageDiagnosisAppType, ComponentType<{ className?: string }>> = {
  season_color: Palette,
  makeup: Brush,
  hairstyle: Scissors,
  hair_color: Sparkles,
  accessories: Gem,
  outfit: Shirt,
  glasses: Glasses,
  style_vs: Wand2,
};

const supportedAppTypes = new Set<ImageDiagnosisAppType>(imageDiagnosisApps.map((app) => app.type));
const fallbackSteps = ['读取照片特征', '匹配子应用 Prompt', '调用图片模型', '输出分享报告'];

export function ImageDiagnosisPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { status } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const returningHomeRef = useRef(false);
  const initialAppType = getAppTypeFromSearch(location.search);
  const initialReport = useMemo(() => {
    const reportId = new URLSearchParams(location.search).get('resultId');
    return reportId ? findImageDiagnosisReport(reportId) : null;
  }, [location.search]);
  const [selectedAppType, setSelectedAppType] = useState<ImageDiagnosisAppType | null>(
    initialReport?.appType ?? initialAppType
  );
  const [phase, setPhase] = useState<'upload' | 'analyzing' | 'report'>(
    initialReport ? 'report' : 'upload'
  );
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [option, setOption] = useState(
    () => initialReport?.option ?? getImageDiagnosisApp(initialAppType ?? 'season_color').options[0].value
  );
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState('准备生成诊断报告');
  const [report, setReport] = useState<ImageDiagnosisReport | null>(initialReport);
  const [isCreating, setIsCreating] = useState(false);
  const [settings, setSettings] = useState<ImageDiagnosisGenerationSettings>(
    initialReport?.settings ?? defaultImageDiagnosisSettings
  );
  const [records, setRecords] = useState<ImageDiagnosisRecord[]>(() => listImageDiagnosisRecords());

  const selectedApp = selectedAppType ? getImageDiagnosisApp(selectedAppType) : null;
  const activeStep = useMemo(() => {
    const index = Math.min(fallbackSteps.length - 1, Math.floor(progress / 26));
    return fallbackSteps[index];
  }, [progress]);

  const hasDirectToken = hasImageDiagnosisDirectToken();

  useEffect(() => {
    captureImageDiagnosisUrlToken();
  }, [location.search]);

  useEffect(() => {
    if (status !== 'unauthenticated' || hasDirectToken) return;
    const current = window.location.pathname + window.location.search;
    navigate(`/login?redirect=${encodeURIComponent(current)}`, { replace: true });
  }, [hasDirectToken, navigate, status]);

  useEffect(() => {
    if (selectedApp) return;
    let stopped = false;
    const refresh = async () => {
      const nextRecords = await refreshImageDiagnosisRecords();
      if (!stopped) setRecords(nextRecords);
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 30000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [selectedApp]);

  useEffect(() => {
    const reportId = new URLSearchParams(location.search).get('resultId');
    if (!reportId) {
      returningHomeRef.current = false;
      return;
    }
    if (returningHomeRef.current || report?.id === reportId) return;
    let stopped = false;
    void getImageDiagnosisReport(reportId)
      .then((nextReport) => {
        if (stopped) return;
        setReport(nextReport);
        setSelectedAppType(nextReport.appType);
        setOption(nextReport.option);
        setSettings(nextReport.settings);
        setPhase('report');
      })
      .catch(() => {
        if (!stopped) {
          toast.error('报告不存在或已超过 72 小时保留期，请重新生成');
        }
      });
    return () => {
      stopped = true;
    };
  }, [location.search, report?.id]);

  useEffect(() => {
    if (phase !== 'analyzing' || !taskId) return;

    let stopped = false;
    const timer = window.setInterval(async () => {
      try {
        const result = await getImageDiagnosisTask(taskId);
        if (stopped) return;

        if (result.data.status === 'failed') {
          throw new Error(result.data.message ?? '报告海报生成失败，请稍后重试');
        }

        setProgress(result.data.progress);
        setAnalysisMessage(result.data.message ?? '正在生成报告海报');

        if (result.data.status === 'succeeded' && result.data.reportId) {
          window.clearInterval(timer);
          const nextReport = await getImageDiagnosisReport(result.data.reportId);
          if (!stopped) {
            setReport(nextReport);
            setPhase('report');
            setRecords(listImageDiagnosisRecords());
            navigateWithToken(
              navigate,
              '/apps/image-diagnosis/result',
              {
                appType: nextReport.appType,
                resultId: nextReport.id,
              },
              { replace: true }
            );
          }
        }
      } catch (error) {
        window.clearInterval(timer);
        if (!stopped) {
          toast.error(error instanceof Error ? error.message : '报告海报生成失败，请稍后重试');
          setPhase('upload');
        }
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [navigate, phase, taskId]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleSelectApp(appType: ImageDiagnosisAppType) {
    const app = getImageDiagnosisApp(appType);
    setSelectedAppType(appType);
    setOption(app.options[0].value);
    setPhase('upload');
    setReport(null);
    navigateWithToken(navigate, '/apps/image-diagnosis/run', { appType });
  }

  async function handleOpenRecord(record: ImageDiagnosisRecord) {
    setSelectedAppType(record.appType);
    if (record.status === 'succeeded') {
      try {
        const nextReport = await getImageDiagnosisReport(record.reportId);
        setReport(nextReport);
        setPhase('report');
        navigateWithToken(
          navigate,
          '/apps/image-diagnosis/result',
          {
            appType: nextReport.appType,
            resultId: nextReport.id,
          },
          { replace: true }
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '报告不存在，请重新生成');
      }
      return;
    }

    setTaskId(record.taskId);
    setProgress(record.progress);
    setAnalysisMessage(record.message);
    setPhase('analyzing');
    navigateWithToken(
      navigate,
      '/apps/image-diagnosis/loading',
      {
        appType: record.appType,
        taskId: record.taskId,
      },
      { replace: true }
    );
  }

  function handleBackHome() {
    returningHomeRef.current = true;
    setSelectedAppType(null);
    setPhase('upload');
    setProgress(0);
    setTaskId('');
    setReport(null);
    navigateWithToken(navigate, '/apps/image-diagnosis', {}, { replace: true });
  }

  function handlePickImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请上传 JPG、PNG 或 HEIC 图片');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('图片建议控制在 8MB 以内');
      return;
    }

    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    setImageFile(file);
    setReport(null);
  }

  async function handleStart() {
    if (status === 'unauthenticated' && !hasDirectToken) {
      const current = window.location.pathname + window.location.search;
      navigate(`/login?redirect=${encodeURIComponent(current)}`, { replace: true });
      return;
    }

    if (!selectedAppType) {
      toast.error('请先选择一个诊断功能');
      return;
    }

    if (!previewUrl || !imageFile) {
      toast.error('请先上传一张清晰正面照');
      return;
    }

    setIsCreating(true);
    try {
      const result = await createImageDiagnosisTask({
        appType: selectedAppType,
        imageFile,
        imageUrl: previewUrl,
        option,
        settings,
      });
      setTaskId(result.data.taskId);
      setRecords(listImageDiagnosisRecords());
      toast.success('已提交后台生成，可在首页历史记录查看进度');
      setSelectedAppType(null);
      setPhase('upload');
      navigateWithToken(navigate, '/apps/image-diagnosis');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建生成任务失败');
    } finally {
      setIsCreating(false);
    }
  }

  function handleReset() {
    setPhase('upload');
    setProgress(0);
    setAnalysisMessage('准备生成诊断报告');
    setTaskId('');
    setReport(null);
    if (selectedAppType) navigateWithToken(navigate, '/apps/image-diagnosis/run', { appType: selectedAppType });
  }

  function handleDownload() {
    if (!report) return;
    const link = document.createElement('a');
    link.href = report.posterUrl;
    link.download = `image-diagnosis-${report.appType}-${report.id}.png`;
    link.click();
  }

  return (
    <main className='min-h-dvh bg-[#f7f3ed] text-[#272521]'>
      <div className='mx-auto flex w-full max-w-[480px] flex-col px-4 py-5'>
        {!selectedApp ? (
          <HomeView records={records} onSelectApp={handleSelectApp} onOpenRecord={handleOpenRecord} />
        ) : (
          <>
            <TopBar app={selectedApp} onBack={handleBackHome} />
            {phase === 'upload' && (
              <UploadView
                app={selectedApp}
                previewUrl={previewUrl}
                option={option}
                settings={settings}
                isCreating={isCreating}
                onPickClick={() => fileInputRef.current?.click()}
                onOptionChange={setOption}
                onSettingsChange={setSettings}
                onStart={handleStart}
              />
            )}
            {phase === 'analyzing' && (
              <AnalyzingView
                app={selectedApp}
                previewUrl={previewUrl}
                progress={progress}
                activeStep={analysisMessage || activeStep}
              />
            )}
            {phase === 'report' && report && (
              <ReportView report={report} onReset={handleReset} onDownload={handleDownload} />
            )}
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        className='hidden'
        type='file'
        accept='image/*'
        onChange={handlePickImage}
      />
    </main>
  );
}

function HomeView({
  records,
  onSelectApp,
  onOpenRecord,
}: {
  records: ImageDiagnosisRecord[];
  onSelectApp: (appType: ImageDiagnosisAppType) => void;
  onOpenRecord: (record: ImageDiagnosisRecord) => void;
}) {
  const recommended = imageDiagnosisApps.filter((app) =>
    ['season_color', 'outfit', 'style_vs'].includes(app.type)
  );

  return (
    <section className='space-y-5'>
      <header className='rounded-lg border border-[#e6dacb] bg-white p-5 shadow-sm'>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <p className='text-xs font-medium uppercase tracking-[0.18em] text-[#946d53]'>AI STYLE</p>
            <h1 className='mt-2 text-3xl font-semibold leading-tight'>AI 个人形象诊断</h1>
            <p className='mt-3 text-sm leading-6 text-[#6f685f]'>
              选择你想优化的方向：色彩、妆容、发型、发色、饰品、穿搭、眼镜，一项一项变得更适合自己。
            </p>
          </div>
          <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[#26312d] text-[#f8f3ec]'>
            <Sparkles className='h-6 w-6' />
          </div>
        </div>
      </header>

      <section className='space-y-3'>
        <div className='flex items-center justify-between'>
          <h2 className='text-base font-semibold'>推荐功能</h2>
          <span className='text-xs text-[#8b8176]'>P0 优先上线</span>
        </div>
        <div className='grid gap-3'>
          {recommended.map((app) => (
            <AppEntry key={app.type} app={app} featured onSelectApp={onSelectApp} />
          ))}
        </div>
      </section>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold'>全部诊断功能</h2>
        <div className='grid grid-cols-2 gap-3'>
          {imageDiagnosisApps.map((app) => (
            <AppEntry key={app.type} app={app} onSelectApp={onSelectApp} />
          ))}
        </div>
      </section>

      <section className='space-y-3 rounded-lg border border-[#e3d8ca] bg-white p-4 shadow-sm'>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <CheckCircle2 className='h-5 w-5 text-[#6f8b74]' />
            <div>
              <h2 className='text-sm font-semibold'>历史记录</h2>
              <p className='mt-1 text-xs text-[#7a7368]'>异步生成的报告完成后会出现在这里。</p>
            </div>
          </div>
          <span className='text-xs text-[#8b8176]'>{records.length} 条</span>
        </div>
        {records.length > 0 && (
          <div className='grid gap-2'>
            {records.slice(0, 5).map((record) => (
              <button
                key={record.taskId}
                type='button'
                onClick={() => onOpenRecord(record)}
                className='flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-[#eee3d7] bg-[#fbf8f3] px-3 py-3 text-left'
              >
                <span className='min-w-0 flex-1 overflow-hidden'>
                  <span className='block max-w-full truncate text-sm font-semibold'>{record.appTitle}</span>
                  <span className='mt-1 line-clamp-2 max-w-full break-words text-xs leading-5 text-[#7a7368]'>
                    {record.optionLabel} · {record.message}
                  </span>
                </span>
                <span className='shrink-0 rounded-full bg-white px-2 py-1 text-xs text-[#8b614b]'>
                  {record.status === 'succeeded' ? '查看' : `${record.progress}%`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function AppEntry({
  app,
  featured,
  onSelectApp,
}: {
  app: ImageDiagnosisAppConfig;
  featured?: boolean;
  onSelectApp: (appType: ImageDiagnosisAppType) => void;
}) {
  const Icon = appIcons[app.type];

  return (
    <button
      type='button'
      onClick={() => onSelectApp(app.type)}
      className={cn(
        'group flex min-h-[132px] flex-col justify-between rounded-lg border bg-white p-4 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#9b7159] focus:ring-offset-2 focus:ring-offset-[#f7f3ed]',
        featured ? 'border-[#cbb9a7]' : 'border-[#e3d8ca]'
      )}
    >
      <span className='flex items-start justify-between gap-3'>
        <span className='flex h-10 w-10 items-center justify-center rounded-md bg-[#eef2e8] text-[#536b58]'>
          <Icon className='h-5 w-5' />
        </span>
        <span className='rounded-full bg-[#f1e7dc] px-2 py-1 text-[11px] font-medium text-[#8b614b]'>
          {app.tag}
        </span>
      </span>
      <span>
        <span className='block text-sm font-semibold'>{app.title}</span>
        <span className='mt-1 block text-xs leading-5 text-[#756d63]'>{app.subtitle}</span>
        <span className='mt-3 flex flex-wrap gap-1'>
          {app.outputs.slice(0, 2).map((item) => (
            <span
              key={item}
              className='rounded-full bg-[#f7f2ea] px-2 py-1 text-[10px] font-medium text-[#84756a]'
            >
              {item}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}

function TopBar({ app, onBack }: { app: ImageDiagnosisAppConfig; onBack: () => void }) {
  return (
    <header className='mb-5 flex items-center justify-between gap-3'>
      <button
        type='button'
        onClick={onBack}
        className='flex h-10 w-10 items-center justify-center rounded-lg border border-[#e3d8ca] bg-white text-[#534d45] shadow-sm'
        aria-label='返回首页'
      >
        <ArrowLeft className='h-5 w-5' />
      </button>
      <div className='min-w-0 flex-1'>
        <p className='text-xs font-medium uppercase tracking-[0.18em] text-[#9b7159]'>AI STYLE</p>
        <h1 className='mt-1 truncate text-2xl font-semibold leading-tight'>{app.title}</h1>
      </div>
      <div className='flex h-11 w-11 items-center justify-center rounded-lg bg-[#26312d] text-[#f8f3ec] shadow-sm'>
        <Sparkles className='h-5 w-5' />
      </div>
    </header>
  );
}

function UploadView({
  app,
  previewUrl,
  option,
  settings,
  isCreating,
  onPickClick,
  onOptionChange,
  onSettingsChange,
  onStart,
}: {
  app: ImageDiagnosisAppConfig;
  previewUrl: string;
  option: string;
  settings: ImageDiagnosisGenerationSettings;
  isCreating: boolean;
  onPickClick: () => void;
  onOptionChange: (value: string) => void;
  onSettingsChange: (settings: ImageDiagnosisGenerationSettings) => void;
  onStart: () => void;
}) {
  const Icon = appIcons[app.type];

  return (
    <section className='space-y-4'>
      <div className='rounded-lg border border-[#e3d8ca] bg-white p-4 shadow-sm'>
        <div className='flex items-start gap-3'>
          <div className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eef2e8] text-[#536b58]'>
            <Icon className='h-4 w-4' />
          </div>
          <div>
            <h2 className='text-lg font-semibold'>{app.title}</h2>
            <p className='mt-1 text-sm leading-6 text-[#70685e]'>{app.description}</p>
          </div>
        </div>
      </div>

      <section className='rounded-lg border border-[#e3d8ca] bg-white p-4 shadow-sm'>
        <div className='flex items-center justify-between gap-3'>
          <h2 className='text-base font-semibold'>本次会分析</h2>
          <span className='text-xs text-[#8b8176]'>{app.options.length} 个场景</span>
        </div>
        <div className='mt-3 flex flex-wrap gap-2'>
          {app.outputs.map((item) => (
            <span
              key={item}
              className='rounded-full bg-[#f4eee5] px-3 py-1.5 text-xs font-medium text-[#6f6258]'
            >
              {item}
            </span>
          ))}
        </div>
        <div className='mt-4 grid gap-2'>
          {app.audience.map((item) => (
            <div key={item} className='flex items-center gap-2 text-sm text-[#70685e]'>
              <CheckCircle2 className='h-4 w-4 shrink-0 text-[#6f8b74]' />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>

      <button
        type='button'
        onClick={onPickClick}
        className={cn(
          'relative flex min-h-[260px] w-full flex-col items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#cbb9a7] bg-white text-left shadow-sm transition',
          'focus:outline-none focus:ring-2 focus:ring-[#9b7159] focus:ring-offset-2 focus:ring-offset-[#f8f3ec]'
        )}
      >
        {previewUrl ? (
          <>
            <img
              src={previewUrl}
              alt='待生成报告的照片'
              className='absolute inset-0 h-full w-full object-cover'
            />
            <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1f2421]/85 to-transparent p-4 text-white'>
              <p className='text-sm font-medium'>点击更换照片</p>
            </div>
          </>
        ) : (
          <div className='flex flex-col items-center px-8 text-center'>
            <div className='flex h-14 w-14 items-center justify-center rounded-lg bg-[#efe7db] text-[#9b7159]'>
              <ImagePlus className='h-7 w-7' />
            </div>
            <p className='mt-4 font-semibold'>选择一张清晰正面照</p>
            <p className='mt-2 text-sm leading-6 text-[#7a7368]'>
              自然光、无遮挡、半身构图效果更稳定
            </p>
          </div>
        )}
      </button>

      <div className='grid grid-cols-3 gap-2 rounded-lg border border-[#e3d8ca] bg-white p-3 shadow-sm'>
        {['人物清晰', '光线均匀', '适合海报'].map((item) => (
          <div
            key={item}
            className='flex flex-col items-center gap-2 text-center text-xs text-[#70685e]'
          >
            <CheckCircle2 className='h-4 w-4 text-[#6f8b74]' />
            <span>{item}</span>
          </div>
        ))}
      </div>

      <section className='space-y-3'>
        <h2 className='text-base font-semibold'>{app.optionLabel}</h2>
        <div className='grid gap-2'>
          {app.options.map((item) => {
            const active = option === item.value;
            return (
              <button
                key={item.value}
                type='button'
                onClick={() => onOptionChange(item.value)}
                className={cn(
                  'flex items-center justify-between rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition',
                  active ? 'border-[#9b7159] ring-2 ring-[#9b7159]/15' : 'border-[#e3d8ca]'
                )}
              >
                <span>
                  <span className='block text-sm font-semibold'>{item.title}</span>
                  <span className='mt-1 block text-xs text-[#7a7368]'>{item.desc}</span>
                  {active && (
                    <span className='mt-2 block text-xs leading-5 text-[#9b7159]'>
                      {item.prompt}
                    </span>
                  )}
                </span>
                <ChevronRight
                  className={cn('h-4 w-4', active ? 'text-[#9b7159]' : 'text-[#b5aa9f]')}
                />
              </button>
            );
          })}
        </div>
      </section>

      <section className='space-y-3 rounded-lg border border-[#e3d8ca] bg-white p-4 shadow-sm'>
        <div className='flex items-center justify-between gap-3'>
          <h2 className='text-base font-semibold'>生成设置</h2>
          <span className='text-xs text-[#8b8176]'>
            {getImageDiagnosisResolutionLabel(settings.resolution)}
          </span>
        </div>

        <div className='space-y-2'>
          <p className='text-xs font-medium text-[#7a7368]'>海报分辨率</p>
          <div className='grid gap-2'>
            {imageDiagnosisResolutionOptions.map((item) => {
              const active = settings.resolution === item.value;
              return (
                <button
                  key={item.value}
                  type='button'
                  onClick={() => onSettingsChange({ ...settings, resolution: item.value })}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left transition',
                    active ? 'border-[#9b7159] bg-[#fff8f2]' : 'border-[#eee3d7] bg-[#fbf8f3]'
                  )}
                >
                  <span className='block text-sm font-semibold'>{item.label}</span>
                  <span className='mt-1 block text-xs leading-5 text-[#7a7368]'>{item.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className='text-xs leading-5 text-[#9b7159]'>
          高清海报将自动异步生成，提交后可返回首页，在历史记录中查看进度和成品。
        </p>
      </section>

      <Button
        type='button'
        className='h-12 w-full rounded-lg bg-[#26312d] text-base text-white hover:bg-[#33443e]'
        disabled={isCreating}
        onClick={onStart}
      >
        {isCreating ? <Loader2 className='h-4 w-4 animate-spin' /> : <Camera className='h-4 w-4' />}
        提交生成
      </Button>
    </section>
  );
}

function AnalyzingView({
  app,
  previewUrl,
  progress,
  activeStep,
}: {
  app: ImageDiagnosisAppConfig;
  previewUrl: string;
  progress: number;
  activeStep: string;
}) {
  return (
    <section className='space-y-4'>
      <div className='overflow-hidden rounded-lg border border-[#e3d8ca] bg-white shadow-sm'>
        <div className='aspect-[4/5] bg-[#efe7db]'>
          {previewUrl && (
            <img src={previewUrl} alt='生成中的照片' className='h-full w-full object-cover' />
          )}
        </div>
        <div className='p-4'>
          <div className='mb-3 flex items-center justify-between'>
            <span className='text-sm font-semibold'>正在生成{app.title}报告</span>
            <span className='text-sm text-[#9b7159]'>{progress}%</span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-[#efe7db]'>
            <div
              className='h-full rounded-full bg-[#6f8b74] transition-all duration-500'
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className='mt-4 flex items-center gap-2 text-sm text-[#70685e]'>
            <Loader2 className='h-4 w-4 animate-spin text-[#9b7159]' />
            {activeStep}
          </p>
        </div>
      </div>

      <div className='rounded-lg border border-[#d9c5ba] bg-[#fff7f2] p-4 text-sm leading-6 text-[#795b50]'>
        高清海报生成中，请耐心等待或保持页面开启。
        <br />
        您也可以先去忙别的，返回首页后系统将自动在后台完成，稍后请在“历史记录”中验收您的作品。
      </div>
    </section>
  );
}

function ReportView({
  report,
  onReset,
  onDownload,
}: {
  report: ImageDiagnosisReport;
  onReset: () => void;
  onDownload: () => void;
}) {
  return (
    <section className='space-y-4'>
      <div className='overflow-hidden rounded-lg border border-[#d8c8b8] bg-white shadow-sm'>
        <div className='border-b border-[#eadfd2] px-4 py-3'>
          <p className='text-xs font-medium uppercase tracking-[0.18em] text-[#9b7159]'>
            AI REPORT
          </p>
          <h2 className='mt-1 text-lg font-semibold'>{report.appTitle}已生成</h2>
          <p className='mt-1 text-xs text-[#7a7368]'>
            {getImageDiagnosisOptionLabel(report.appType, report.option)} · {report.model}
          </p>
        </div>
        <img src={report.posterUrl} alt={`${report.appTitle}报告海报`} className='w-full bg-[#f6efe6]' />
      </div>

      <div className='grid grid-cols-2 gap-3 pb-4'>
        <Button
          type='button'
          variant='outline'
          className='h-11 rounded-lg border-[#cbb9a7] bg-white'
          onClick={onReset}
        >
          <RefreshCcw className='h-4 w-4' />
          重新上传
        </Button>
        <Button
          type='button'
          className='h-11 rounded-lg bg-[#26312d] text-white hover:bg-[#33443e]'
          onClick={onDownload}
        >
          <Download className='h-4 w-4' />
          保存海报
        </Button>
      </div>
    </section>
  );
}

function getAppTypeFromSearch(search: string): ImageDiagnosisAppType | null {
  const appType = new URLSearchParams(search).get('appType') as ImageDiagnosisAppType | null;
  return appType && supportedAppTypes.has(appType) ? appType : null;
}

function navigateWithToken(
  navigate: ReturnType<typeof useNavigate>,
  pathname: string,
  params: Record<string, string | undefined> = {},
  options: { replace?: boolean } = {}
) {
  const nextParams = new URLSearchParams();
  const navigationToken = getImageDiagnosisNavigationTokenParam();
  if (navigationToken) nextParams.set(navigationToken.name, navigationToken.value);
  Object.entries(params).forEach(([name, value]) => {
    if (value) nextParams.set(name, value);
  });
  const search = nextParams.toString();
  navigate(`${pathname}${search ? `?${search}` : ''}`, { replace: options.replace ?? false });
}
