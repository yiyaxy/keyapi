import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ChevronRight,
  Download,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import {
  createImageDiagnosisTask,
  getImageDiagnosisGoalLabel,
  getImageDiagnosisReport,
  getImageDiagnosisTask,
  type ImageDiagnosisReport,
  type ImageDiagnosisStyleGoal,
} from '@/lib/imageDiagnosis';
import { cn } from '@/lib/utils';

const styleGoals: Array<{
  value: ImageDiagnosisStyleGoal;
  title: string;
  desc: string;
}> = [
  { value: 'daily_beauty', title: '日常变美', desc: '自然提气色' },
  { value: 'commute', title: '通勤显气质', desc: '干净、有精神' },
  { value: 'dating', title: '约会氛围感', desc: '柔和上镜' },
  { value: 'workplace', title: '职场专业感', desc: '利落可信赖' },
  { value: 'elegant', title: '轻熟高级感', desc: '克制有质感' },
];

const fallbackSteps = ['读取照片特征', '规划 VS 报告版式', '生成穿搭模块', '输出分享海报'];

export function ImageDiagnosisPage() {
  const navigate = useNavigate();
  const { status } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<'upload' | 'analyzing' | 'report'>('upload');
  const [previewUrl, setPreviewUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [styleGoal, setStyleGoal] = useState<ImageDiagnosisStyleGoal>('daily_beauty');
  const [taskId, setTaskId] = useState('');
  const [progress, setProgress] = useState(0);
  const [analysisMessage, setAnalysisMessage] = useState('准备生成穿搭分析海报');
  const [report, setReport] = useState<ImageDiagnosisReport | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const activeStep = useMemo(() => {
    const index = Math.min(fallbackSteps.length - 1, Math.floor(progress / 26));
    return fallbackSteps[index];
  }, [progress]);

  const hasDirectToken = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return Boolean(params.get('token') || params.get('key'));
  }, []);

  useEffect(() => {
    if (status !== 'unauthenticated' || hasDirectToken) return;
    const current = window.location.pathname + window.location.search;
    navigate(`/login?redirect=${encodeURIComponent(current)}`, { replace: true });
  }, [hasDirectToken, navigate, status]);

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
          }
        }
      } catch (error) {
        window.clearInterval(timer);
        if (!stopped) {
          toast.error(error instanceof Error ? error.message : '报告海报生成失败，请稍后重试');
          setPhase('upload');
        }
      }
    }, 700);

    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, taskId]);

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
    setFileName(file.name);
    setReport(null);
  }

  async function handleStart() {
    if (status === 'unauthenticated' && !hasDirectToken) {
      const current = window.location.pathname + window.location.search;
      navigate(`/login?redirect=${encodeURIComponent(current)}`, { replace: true });
      return;
    }

    if (!previewUrl || !imageFile) {
      toast.error('请先上传一张清晰正面照');
      return;
    }

    setIsCreating(true);
    try {
      const result = await createImageDiagnosisTask({
        imageFile,
        imageUrl: previewUrl,
        styleGoal,
      });
      setTaskId(result.data.taskId);
      setProgress(8);
      setAnalysisMessage('获取应用调用凭证');
      setPhase('analyzing');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建生成任务失败');
    } finally {
      setIsCreating(false);
    }
  }

  function handleReset() {
    setPhase('upload');
    setProgress(0);
    setAnalysisMessage('准备生成穿搭分析海报');
    setTaskId('');
    setReport(null);
  }

  function handleDownload() {
    if (!report) return;
    const link = document.createElement('a');
    link.href = report.posterUrl;
    link.download = `personal-style-analysis-${report.id}.png`;
    link.click();
  }

  return (
    <main className='min-h-dvh bg-[#f8f3ec] text-[#2c2a27]'>
      <div className='mx-auto flex w-full max-w-[480px] flex-col px-4 py-5'>
        <TopBar />
        {phase === 'upload' && (
          <UploadView
            previewUrl={previewUrl}
            fileName={fileName}
            styleGoal={styleGoal}
            isCreating={isCreating}
            onPickClick={() => fileInputRef.current?.click()}
            onStyleGoalChange={setStyleGoal}
            onStart={handleStart}
          />
        )}
        {phase === 'analyzing' && (
          <AnalyzingView
            previewUrl={previewUrl}
            progress={progress}
            activeStep={analysisMessage || activeStep}
          />
        )}
        {phase === 'report' && report && (
          <ReportView report={report} onReset={handleReset} onDownload={handleDownload} />
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

function TopBar() {
  return (
    <header className='mb-5 flex items-center justify-between'>
      <div>
        <p className='text-xs font-medium uppercase tracking-[0.18em] text-[#9b7159]'>AI STYLE</p>
        <h1 className='mt-1 text-2xl font-semibold leading-tight'>个人穿搭分析</h1>
      </div>
      <div className='flex h-11 w-11 items-center justify-center rounded-lg bg-[#26312d] text-[#f8f3ec] shadow-sm'>
        <Sparkles className='h-5 w-5' />
      </div>
    </header>
  );
}

function UploadView({
  previewUrl,
  fileName,
  styleGoal,
  isCreating,
  onPickClick,
  onStyleGoalChange,
  onStart,
}: {
  previewUrl: string;
  fileName: string;
  styleGoal: ImageDiagnosisStyleGoal;
  isCreating: boolean;
  onPickClick: () => void;
  onStyleGoalChange: (goal: ImageDiagnosisStyleGoal) => void;
  onStart: () => void;
}) {
  return (
    <section className='space-y-4'>
      <div className='rounded-lg border border-[#e3d8ca] bg-white p-4 shadow-sm'>
        <div className='flex items-start gap-3'>
          <div className='mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eef2e8] text-[#536b58]'>
            <Wand2 className='h-4 w-4' />
          </div>
          <div>
            <h2 className='text-lg font-semibold'>上传照片，生成图片式报告</h2>
            <p className='mt-1 text-sm leading-6 text-[#70685e]'>
              使用 gpt-image2 直接生成 VS 风格对比、穿搭示例、色卡和场景建议海报。
            </p>
          </div>
        </div>
      </div>

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
              <p className='truncate text-sm font-medium'>{fileName}</p>
              <p className='mt-1 text-xs text-white/75'>点击更换照片</p>
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
        <h2 className='text-base font-semibold'>选择你的目标风格</h2>
        <div className='grid gap-2'>
          {styleGoals.map((goal) => {
            const active = styleGoal === goal.value;
            return (
              <button
                key={goal.value}
                type='button'
                onClick={() => onStyleGoalChange(goal.value)}
                className={cn(
                  'flex items-center justify-between rounded-lg border bg-white px-4 py-3 text-left shadow-sm transition',
                  active ? 'border-[#9b7159] ring-2 ring-[#9b7159]/15' : 'border-[#e3d8ca]'
                )}
              >
                <span>
                  <span className='block text-sm font-semibold'>{goal.title}</span>
                  <span className='mt-1 block text-xs text-[#7a7368]'>{goal.desc}</span>
                </span>
                <ChevronRight
                  className={cn('h-4 w-4', active ? 'text-[#9b7159]' : 'text-[#b5aa9f]')}
                />
              </button>
            );
          })}
        </div>
      </section>

      <Button
        type='button'
        className='h-12 w-full rounded-lg bg-[#26312d] text-base text-white hover:bg-[#33443e]'
        disabled={isCreating}
        onClick={onStart}
      >
        {isCreating ? <Loader2 className='h-4 w-4 animate-spin' /> : <Camera className='h-4 w-4' />}
        生成穿搭分析海报
      </Button>
    </section>
  );
}

function AnalyzingView({
  previewUrl,
  progress,
  activeStep,
}: {
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
            <span className='text-sm font-semibold'>正在生成图片式报告</span>
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
        gpt-image2 会直接输出完整长图海报，包含左右 VS、色卡、配饰、穿搭示例和适合场景。
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
            STYLE POSTER
          </p>
          <h2 className='mt-1 text-lg font-semibold'>
            {getImageDiagnosisGoalLabel(report.styleGoal)}报告已生成
          </h2>
          <p className='mt-1 text-xs text-[#7a7368]'>模型：{report.model}</p>
        </div>
        <img src={report.posterUrl} alt='个人穿搭分析报告海报' className='w-full bg-[#f6efe6]' />
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
