import { useRef, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

function getRateColor(rate, thresholds) {
  if (rate < 0) return 'var(--semi-color-text-2)';
  if (rate >= thresholds.good) return 'rgb(34,197,94)';
  if (rate >= thresholds.warn) return 'rgb(245,158,11)';
  return 'rgb(239,68,68)';
}

function formatRate(rate) {
  if (rate == null || rate < 0) return null;
  return `${(rate * 100).toFixed(1)}%`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTooltipTime(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeHistoryPoint(point) {
  const availabilityRate = Math.max(0, point?.availability_rate ?? 0);
  const hasCacheRate = typeof point?.cache_hit_rate === 'number' && point.cache_hit_rate >= 0;
  return {
    ...point,
    availability_rate: availabilityRate,
    cache_hit_rate: hasCacheRate ? Math.max(0, point.cache_hit_rate) : -1,
    has_cache_rate: hasCacheRate,
    previous_value_used: Boolean(point?.previous_value_used),
  };
}

function getHealthBadge(status, t) {
  if (status === 'error' || status === 'abnormal') {
    return {
      label: t('channelMonitor.statusError'),
      background: 'var(--semi-color-danger-light-default)',
      color: 'var(--semi-color-danger)',
    };
  }
  if (status === 'warning' || status === 'degraded') {
    return {
      label: t('channelMonitor.statusWarning'),
      background: 'var(--semi-color-warning-light-default)',
      color: 'var(--semi-color-warning)',
    };
  }
  if (status === 'success' || status === 'normal') {
    return {
      label: t('channelMonitor.statusNormal'),
      background: 'var(--semi-color-success-light-default)',
      color: 'var(--semi-color-success)',
    };
  }
  return {
    label: t('channelMonitor.statusNormal'),
    background: 'var(--semi-color-success-light-default)',
    color: 'var(--semi-color-success)',
  };
}

function splitModels(channels) {
  const set = new Set();
  channels.forEach((channel) => {
    (channel.models || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => set.add(item));
  });
  return Array.from(set);
}

export default function ChannelMonitorCard({ group }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);

  const availabilityRate = group.avg_availability_rate ?? 0;
  const cacheHitRate = group.avg_cache_hit_rate ?? -1;
  const hasCacheData = cacheHitRate >= 0;
  const history = useMemo(
    () => (group.history || []).map((point) => normalizeHistoryPoint(point)),
    [group.history],
  );
  const healthBadge = useMemo(
    () => getHealthBadge(group.health_status, t),
    [group.health_status, t],
  );

  const availabilityColor = getRateColor(availabilityRate, { good: 0.9, warn: 0.7 });
  const cacheHitColor = getRateColor(cacheHitRate, { good: 0.7, warn: 0.4 });

  const availabilityPct = formatRate(availabilityRate) || '0.0%';
  const cacheHitPct = formatRate(cacheHitRate);

  const models = useMemo(() => splitModels(group.channels || []), [group.channels]);
  const primaryModel = models[0] || '-';

  const avgLatency = useMemo(() => {
    const rows = (group.channels || []).filter((item) => item.response_time_ms > 0);
    if (rows.length === 0) return '-';
    const avg = rows.reduce((sum, item) => sum + item.response_time_ms, 0) / rows.length;
    return avg >= 1000 ? `${(avg / 1000).toFixed(2)}s` : `${Math.round(avg)}ms`;
  }, [group.channels]);

  const groupPricePerDollar = useMemo(() => {
    const totalQuota = (group.channels || []).reduce(
      (sum, item) => sum + (item.used_quota_1h || 0),
      0,
    );
    const totalBalance = (group.channels || []).reduce(
      (sum, item) => sum + (item.balance || 0),
      0,
    );
    if (totalQuota <= 0 || totalBalance <= 0) return null;
    return (totalQuota / (totalBalance * 500000)).toFixed(2);
  }, [group.channels]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);

    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    if (history.length === 0) {
      const y = h / 2;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(59,130,246,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const xStep = history.length > 1 ? w / (history.length - 1) : w;

    ctx.beginPath();
    ctx.strokeStyle = 'rgb(59,130,246)';
    ctx.lineWidth = 1.5;
    history.forEach((point, i) => {
      const x = i * xStep;
      const y = h - point.availability_rate * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    const cachePoints = history.filter((point) => point.has_cache_rate);
    if (cachePoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgb(34,197,94)';
      ctx.lineWidth = 1.5;
      cachePoints.forEach((point, index) => {
        const historyIndex = history.indexOf(point);
        const x = historyIndex * xStep;
        const y = h - point.cache_hit_rate * h;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, [history]);

  const handleCanvasLeave = () => {
    setHoveredPoint(null);
  };

  const handleCanvasMove = (event) => {
    if (!canvasRef.current || history.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    const ratio = rect.width > 0 ? relativeX / rect.width : 0;
    const index = Math.min(
      history.length - 1,
      Math.max(0, Math.round(ratio * (history.length - 1))),
    );
    const point = history[index];
    setHoveredPoint({
      index,
      point,
      left: history.length > 1 ? `${(index / (history.length - 1)) * 100}%` : '0%',
    });
  };

  const timeLabelLeft = history.length ? formatTime(history[0].ts) : '';
  const timeLabelRight = history.length ? formatTime(history[history.length - 1].ts) : '';

  return (
    <div
      style={{
        background: 'var(--semi-color-bg-0)',
        border: '1px solid var(--semi-color-border)',
        borderRadius: '12px',
        padding: '20px',
        boxShadow:
          'rgba(0,0,0,0.08) 0px 2px 8px, rgba(0,0,0,0.06) 0px 1px 3px',
      }}
    >
      <div className='flex items-center justify-between mb-1 gap-2'>
        <div
          title={group.group_name}
          style={{
            flex: 1,
            fontSize: '15px',
            fontWeight: 650,
            color: 'var(--semi-color-text-0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {group.group_name}
        </div>
        <span
          title={group.health_reason || ''}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            fontWeight: 600,
            padding: '3px 10px',
            borderRadius: '20px',
            flexShrink: 0,
            background: healthBadge.background,
            color: healthBadge.color,
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: healthBadge.color,
            }}
          />
          {healthBadge.label}
        </span>
      </div>

      <div className='flex items-center mb-3 gap-2 text-[12px]' style={{ color: 'var(--semi-color-text-2)' }}>
        <span
          title={models.join(', ')}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
            flex: 1,
          }}
        >
          {primaryModel}
        </span>
        <div style={{ width: '1px', height: '12px', background: 'var(--semi-color-border)', flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {avgLatency}
        </span>
        {groupPricePerDollar && (
          <>
            <div style={{ width: '1px', height: '12px', background: 'var(--semi-color-border)', flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {groupPricePerDollar}元/刀
            </span>
          </>
        )}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div className='flex items-center justify-between' style={{ marginBottom: '5px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-1)', fontWeight: 500 }}>
            {t('channelMonitor.availability')}
          </span>
          <span style={{ fontSize: '13px', fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: availabilityColor }}>
            {availabilityPct}
          </span>
        </div>
        <div style={{ height: '6px', background: 'var(--semi-color-fill-0)', borderRadius: '3px', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: '3px', width: `${availabilityRate * 100}%`, background: availabilityColor }} />
        </div>
      </div>

      <div style={{ marginBottom: '0px' }}>
        <div className='flex items-center justify-between' style={{ marginBottom: '5px' }}>
          <span style={{ fontSize: '12px', color: 'var(--semi-color-text-1)', fontWeight: 500 }}>
            {t('channelMonitor.cacheHitRate')}
          </span>
          {hasCacheData ? (
            <span style={{ fontSize: '13px', fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: cacheHitColor }}>
              {cacheHitPct}
            </span>
          ) : (
            <span style={{ fontSize: '13px', fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: 'var(--semi-color-text-2)' }}>
              {t('channelMonitor.noData')}
            </span>
          )}
        </div>
        <div style={{ height: '6px', background: 'var(--semi-color-fill-0)', borderRadius: '3px', overflow: 'hidden' }}>
          {hasCacheData && (
            <div style={{ height: '100%', borderRadius: '3px', width: `${cacheHitRate * 100}%`, background: cacheHitColor }} />
          )}
        </div>
      </div>

      <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--semi-color-border)' }}>
        <div className='flex items-center justify-between' style={{ marginBottom: '8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--semi-color-text-2)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {t('channelMonitor.history').toUpperCase()}
          </span>
          <div className='flex items-center' style={{ gap: '10px' }}>
            <span className='flex items-center' style={{ gap: '4px', fontSize: '10px', color: 'var(--semi-color-text-2)' }}>
              <span style={{ width: '8px', height: '3px', borderRadius: '2px', background: 'rgb(59, 130, 246)', display: 'inline-block' }} />
              {t('channelMonitor.availability')}
            </span>
            <span className='flex items-center' style={{ gap: '4px', fontSize: '10px', color: 'var(--semi-color-text-2)' }}>
              <span style={{ width: '8px', height: '3px', borderRadius: '2px', background: 'rgb(34, 197, 94)', display: 'inline-block' }} />
              {t('channelMonitor.cacheHitRate')}
            </span>
          </div>
        </div>
        <div
          style={{ height: '80px', position: 'relative' }}
          onMouseLeave={handleCanvasLeave}
        >
          <canvas
            ref={canvasRef}
            onMouseMove={handleCanvasMove}
            style={{ width: '100%', height: '80px', display: 'block' }}
          />
          {hoveredPoint && (
            <>
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: hoveredPoint.left,
                  width: '1px',
                  background: 'rgba(59, 130, 246, 0.25)',
                  transform: 'translateX(-0.5px)',
                  pointerEvents: 'none',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: hoveredPoint.left,
                  bottom: 'calc(100% + 8px)',
                  transform: 'translateX(-50%)',
                  minWidth: '180px',
                  maxWidth: '220px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--semi-color-border)',
                  background: 'var(--semi-color-bg-1)',
                  boxShadow: 'rgba(0,0,0,0.12) 0px 8px 20px',
                  fontSize: '11px',
                  color: 'var(--semi-color-text-1)',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              >
                <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--semi-color-text-0)', marginBottom: '8px' }}>
                  {formatTooltipTime(hoveredPoint.point.ts)}
                </div>
                <div className='flex items-center justify-between gap-3' style={{ marginBottom: '4px' }}>
                  <span>{t('channelMonitor.availability')}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatRate(hoveredPoint.point.availability_rate) || '0.0%'}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3' style={{ marginBottom: '4px' }}>
                  <span>{t('channelMonitor.cacheHitRate')}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {hoveredPoint.point.has_cache_rate
                      ? formatRate(hoveredPoint.point.cache_hit_rate)
                      : t('channelMonitor.noData')}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3' style={{ marginBottom: '4px' }}>
                  <span>{t('channelMonitor.requestCount')}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {hoveredPoint.point.request_count ?? 0}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3' style={{ marginBottom: '4px' }}>
                  <span>{t('channelMonitor.successCount')}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {hoveredPoint.point.success_count ?? 0}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3' style={{ marginBottom: '4px' }}>
                  <span>{t('channelMonitor.errorCount')}</span>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {hoveredPoint.point.error_count ?? 0}
                  </span>
                </div>
                <div className='flex items-center justify-between gap-3'>
                  <span>{t('channelMonitor.previousValueUsed')}</span>
                  <span style={{ fontWeight: 600 }}>
                    {hoveredPoint.point.previous_value_used ? t('channelMonitor.yes') : t('channelMonitor.no')}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
        <div className='flex justify-between' style={{ fontSize: '10px', color: 'var(--semi-color-text-2)', marginTop: '2px' }}>
          <span>{timeLabelLeft}</span>
          <span>{timeLabelRight}</span>
        </div>
      </div>
    </div>
  );
}
