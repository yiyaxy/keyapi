import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Card,
  Tag,
  Input,
  Button,
  Typography,
  Spin,
  Empty,
  Collapsible,
  Descriptions,
  Toast,
} from '@douyinfe/semi-ui';
import {
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { API, showError } from '../../helpers';
import { renderQuota } from '../../helpers/render';
import { timestamp2string } from '../../helpers/utils';

const { Title, Text } = Typography;

function RequestTrace() {
  const { t } = useTranslation();
  const { requestId: urlRequestId } = useParams();
  const navigate = useNavigate();

  const [requestId, setRequestId] = useState(urlRequestId || '');
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedResponses, setExpandedResponses] = useState({});

  const doSearch = useCallback(
    async (id) => {
      if (!id || !id.trim()) {
        Toast.warning(t('输入 Request ID 查询'));
        return;
      }
      setLoading(true);
      setSearched(true);
      try {
        const res = await API.get(`/api/log/request/${id.trim()}`);
        if (res.data.success) {
          setLogs(res.data.data || []);
        } else {
          showError(res.data.message || 'Request failed');
          setLogs([]);
        }
      } catch (err) {
        showError(err.message || 'Network error');
        setLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (urlRequestId) {
      setRequestId(urlRequestId);
      doSearch(urlRequestId);
    }
  }, [urlRequestId, doSearch]);

  const handleSearch = () => {
    if (requestId.trim()) {
      navigate(`/console/request-trace/${requestId.trim()}`, { replace: true });
      doSearch(requestId.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const toggleResponse = (key) => {
    setExpandedResponses((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const parseOther = (otherStr) => {
    if (!otherStr) return {};
    try {
      if (typeof otherStr === 'object') return otherStr;
      return JSON.parse(otherStr);
    } catch {
      return {};
    }
  };

  const getRetryErrors = (other) => {
    return other?.admin_info?.retry_errors || [];
  };

  const sortedLogs = [...logs].sort((a, b) => {
    if (a.type === b.type) return a.created_at - b.created_at;
    return a.type === 5 ? -1 : 1;
  });

  const isSuccess = (log) => log.type === 2;

  const primaryLog = logs.find((l) => l.type === 2) || logs[0];

  const renderLogTypeName = (type) => {
    switch (type) {
      case 2:
        return t('成功');
      case 5:
        return t('失败');
      default:
        return `Type ${type}`;
    }
  };

  const renderOverview = () => {
    if (!primaryLog) return null;
    const other = parseOther(primaryLog.other);

    const useTimeSec = primaryLog.use_time || 0;
    const frt = other?.frt;

    const descData = [
      {
        key: t('用户'),
        value: primaryLog.username || `ID: ${primaryLog.user_id}`,
      },
      {
        key: t('令牌'),
        value: primaryLog.token_name || '-',
      },
      {
        key: 'Request ID',
        value: (
          <Text copyable className="font-mono text-xs">
            {primaryLog.request_id}
          </Text>
        ),
      },
      {
        key: t('模型'),
        value: primaryLog.model_name || '-',
      },
      {
        key: t('请求时间'),
        value: primaryLog.created_at
          ? timestamp2string(primaryLog.created_at)
          : '-',
      },
      {
        key: t('总耗时'),
        value: useTimeSec > 0
          ? `${useTimeSec}s`
          : '-',
      },
      {
        key: 'FRT',
        value: frt != null && frt >= 0
          ? `${Math.round(frt)}ms`
          : '-',
      },
      {
        key: t('IP地址'),
        value: primaryLog.ip || '-',
      },
      {
        key: t('流式'),
        value: primaryLog.is_stream ? 'Yes' : 'No',
      },
      {
        key: t('渠道'),
        value: primaryLog.channel
          ? `#${primaryLog.channel} ${primaryLog.channel_name || ''}`
          : '-',
      },
      {
        key: t('额度'),
        value: primaryLog.quota ? renderQuota(primaryLog.quota) : '-',
      },
    ];

    // Add upstream request IDs if available
    const adminInfo = other?.admin_info;
    const upstreamIds = adminInfo?.upstream_request_ids;
    if (upstreamIds && Object.keys(upstreamIds).length > 0) {
      Object.entries(upstreamIds).forEach(([key, value]) => {
        descData.push({
          key: `Upstream ${key}`,
          value: (
            <Text copyable className="font-mono text-xs">
              {value}
            </Text>
          ),
        });
      });
    }

    return (
      <Card
        title={
          <div className="flex items-center gap-2">
            <span className="font-semibold">{t('请求概览')}</span>
            {isSuccess(primaryLog) ? (
              <Tag color="green" size="small">
                {t('成功')}
              </Tag>
            ) : (
              <Tag color="red" size="small">
                {t('失败')}
              </Tag>
            )}
          </div>
        }
        className="mb-4"
      >
        <Descriptions data={descData} row size="small" />
      </Card>
    );
  };

  const renderAttemptTimeline = () => {
    const allAttempts = [];

    sortedLogs.forEach((log, logIdx) => {
      const other = parseOther(log.other);
      const retryErrors = getRetryErrors(other);

      retryErrors.forEach((err, errIdx) => {
        allAttempts.push({
          ...err,
          logIndex: logIdx,
          attemptIndex: errIdx,
          logType: log.type,
        });
      });
    });

    // Add the final successful channel
    const consumeLog = logs.find((l) => l.type === 2);
    if (consumeLog) {
      allAttempts.push({
        channel_name: consumeLog.channel_name || `Channel #${consumeLog.channel}`,
        channel_id: consumeLog.channel,
        status_code: 200,
        elapsed_ms: consumeLog.use_time ? consumeLog.use_time * 1000 : 0,
        message: '',
        isFinal: true,
        isSuccess: true,
      });
    }

    if (allAttempts.length === 0) {
      return null;
    }

    const retryCount = allAttempts.filter(
      (a) => !a.isFinal && !a.isSuccess,
    ).length;

    return (
      <Card
        title={
          <div className="flex items-center gap-2">
            <span className="font-semibold">{t('渠道尝试')}</span>
            {retryCount > 0 && (
              <Tag color="orange" size="small">
                {retryCount} {t('次重试')}
              </Tag>
            )}
          </div>
        }
        className="mb-4"
      >
        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-600" />

          {allAttempts.map((attempt, idx) => {
            const isFailed = !attempt.isFinal && !attempt.isSuccess;
            const responseKey = `resp-${idx}`;
            const hasUpstreamBody =
              attempt.upstream_body && attempt.upstream_body.trim();

            return (
              <div key={idx} className="relative pl-10 pb-5 last:pb-0">
                {/* Timeline dot */}
                <div
                  className={`absolute left-2.5 top-1 w-3.5 h-3.5 rounded-full border-2 ${
                    attempt.isFinal && attempt.isSuccess
                      ? 'bg-green-500 border-green-500'
                      : isFailed
                        ? 'bg-red-500 border-red-500'
                        : 'bg-gray-400 border-gray-400'
                  }`}
                />

                <div
                  className={`rounded-lg border p-3 ${
                    attempt.isFinal && attempt.isSuccess
                      ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                      : isFailed
                        ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                        : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Tag color="blue" size="small" className="font-mono">
                      #{idx + 1}
                    </Tag>
                    <Tag color="blue" size="small">
                      CH#{attempt.channel_id}
                    </Tag>
                    <Text className="font-medium text-sm">
                      {attempt.channel_name || '-'}
                    </Text>

                    {attempt.isFinal && attempt.isSuccess ? (
                      <Tag
                        color="green"
                        size="small"
                        prefixIcon={<CheckCircle2 size={12} />}
                      >
                        {t('成功')}
                      </Tag>
                    ) : (
                      <Tag
                        color="red"
                        size="small"
                        prefixIcon={<XCircle size={12} />}
                      >
                        HTTP {attempt.status_code}
                      </Tag>
                    )}

                    {attempt.elapsed_ms > 0 && (
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Clock size={12} />
                        {attempt.elapsed_ms >= 1000
                          ? `${(attempt.elapsed_ms / 1000).toFixed(1)}s`
                          : `${attempt.elapsed_ms}ms`}
                      </span>
                    )}
                  </div>

                  {/* Error message */}
                  {attempt.message && (
                    <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                      {attempt.message}
                    </div>
                  )}

                  {/* Upstream Request IDs */}
                  {attempt.upstream_request_ids && Object.keys(attempt.upstream_request_ids).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(attempt.upstream_request_ids).map(([key, value]) => (
                        <Tag key={key} color="cyan" size="small" className="font-mono text-xs">
                          {key}: <Text copyable={{ content: value }} className="text-xs">{value}</Text>
                        </Tag>
                      ))}
                    </div>
                  )}

                  {/* Upstream response body (collapsible) */}
                  {hasUpstreamBody && (
                    <div className="mt-2">
                      <Button
                        size="small"
                        type="tertiary"
                        theme="borderless"
                        onClick={() => toggleResponse(responseKey)}
                        icon={
                          expandedResponses[responseKey] ? (
                            <ChevronUp size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )
                        }
                      >
                        {expandedResponses[responseKey]
                          ? t('收起')
                          : t('展开上游响应')}
                      </Button>
                      <Collapsible isOpen={expandedResponses[responseKey]}>
                        <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre-wrap break-all">
                          {attempt.upstream_body}
                        </pre>
                      </Collapsible>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  const renderTraceEvents = () => {
    const primaryOther = parseOther(primaryLog?.other);
    const events = primaryOther?.trace_events;
    if (!events || events.length === 0) return null;

    const phaseColors = {
      validate: 'blue',
      init: 'blue',
      sensitive_check: 'violet',
      token_estimate: 'indigo',
      pricing: 'teal',
      pre_billing: 'green',
      channel_select: 'orange',
      upstream: 'cyan',
      refund: 'red',
      post_billing: 'green',
    };

    const baseTime = events[0]?.time || 0;

    return (
      <Card
        title={
          <div className="flex items-center gap-2">
            <span className="font-semibold">{t('处理流程')}</span>
            <Tag color="blue" size="small">
              {events.length} {t('步骤')}
            </Tag>
          </div>
        }
        className="mb-4"
      >
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-600" />

          {events.map((event, idx) => {
            const color = phaseColors[event.phase] || 'grey';
            const relativeMs = event.time - baseTime;

            return (
              <div key={idx} className="relative pl-10 pb-3 last:pb-0">
                <div
                  className="absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2"
                  style={{
                    borderColor: `var(--semi-color-${color})`,
                    backgroundColor: `var(--semi-color-${color}-light-default)`,
                  }}
                />
                <div className="flex items-start gap-2 flex-wrap">
                  <Tag color={color} size="small" className="font-mono text-xs shrink-0">
                    {event.phase}
                  </Tag>
                  <Text className="text-sm">{event.message}</Text>
                  <span className="text-xs text-gray-400 shrink-0">
                    +{relativeMs}ms
                  </span>
                </div>
                {event.detail && Object.keys(event.detail).length > 0 && (
                  <div className="mt-1 ml-1">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gray-500">
                      {Object.entries(event.detail).map(([k, v]) => {
                        if (v == null || v === '') return null;
                        if (k === 'upstream_request_ids' && typeof v === 'object') {
                          return Object.entries(v).map(([hk, hv]) => (
                            <span key={`${k}-${hk}`} className="font-mono">
                              <span className="text-cyan-600">{hk}</span>=
                              <Text copyable={{ content: String(hv) }} className="text-xs">{String(hv)}</Text>
                            </span>
                          ));
                        }
                        return (
                          <span key={k} className="font-mono">
                            {k}=<span className="text-gray-700 dark:text-gray-300">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    );
  };

  const renderFinalResult = () => {
    const consumeLog = logs.find((l) => l.type === 2);
    const errorLog = logs.find((l) => l.type === 5);
    const finalLog = consumeLog || errorLog;
    if (!finalLog) return null;

    const other = parseOther(finalLog.other);
    const adminInfo = other?.admin_info;
    const success = finalLog.type === 2;

    return (
      <Card
        title={
          <div className="flex items-center gap-2">
            <span className="font-semibold">{t('最终结果')}</span>
            {success ? (
              <Tag
                color="green"
                size="small"
                prefixIcon={<CheckCircle2 size={12} />}
              >
                {t('成功')}
              </Tag>
            ) : (
              <Tag
                color="red"
                size="small"
                prefixIcon={<XCircle size={12} />}
              >
                {t('失败')}
              </Tag>
            )}
          </div>
        }
        className="mb-4"
      >
        <div className="space-y-2">
          {success && (
            <>
              <div className="flex gap-4 text-sm">
                <span className="text-gray-500">Prompt tokens:</span>
                <span>{finalLog.prompt_tokens || 0}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-gray-500">Completion tokens:</span>
                <span>{finalLog.completion_tokens || 0}</span>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-gray-500">{t('额度')}:</span>
                <span>{renderQuota(finalLog.quota || 0)}</span>
              </div>
            </>
          )}
          {!success && finalLog.content && (
            <div className="mt-2">
              <Text type="danger" className="text-sm">
                {finalLog.content}
              </Text>
            </div>
          )}
          {/* Show upstream response from admin_info for error logs */}
          {!success && adminInfo?.upstream_response_body && (
            <div className="mt-2">
              <Button
                size="small"
                type="tertiary"
                theme="borderless"
                onClick={() => toggleResponse('final-upstream')}
                icon={
                  expandedResponses['final-upstream'] ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )
                }
              >
                {expandedResponses['final-upstream']
                  ? t('收起')
                  : t('展开上游响应')}
              </Button>
              <Collapsible isOpen={expandedResponses['final-upstream']}>
                <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto max-h-64 overflow-y-auto font-mono whitespace-pre-wrap break-all">
                  {adminInfo.upstream_response_body}
                </pre>
              </Collapsible>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="p-4 max-w-4xl mx-auto" style={{ marginTop: 10 }}>
      <Title heading={3} className="mb-4">
        {t('请求追踪')}
      </Title>

      <div className="flex gap-2 mb-6">
        <Input
          prefix={<Search size={16} className="text-gray-400" />}
          placeholder={t('输入 Request ID 查询')}
          value={requestId}
          onChange={setRequestId}
          onKeyDown={handleKeyDown}
          size="large"
          className="flex-1"
        />
        <Button
          type="primary"
          size="large"
          onClick={handleSearch}
          loading={loading}
        >
          {t('查询')}
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Spin size="large" />
        </div>
      )}

      {!loading && searched && logs.length === 0 && (
        <Empty
          title={t('暂无数据')}
          description={t('未找到该 Request ID 对应的日志记录')}
        />
      )}

      {!loading && logs.length > 0 && (
        <div>
          {renderOverview()}
          {renderTraceEvents()}
          {renderAttemptTimeline()}
          {renderFinalResult()}

          {sortedLogs.length > 1 && (
            <Card
              title={
                <span className="font-semibold">
                  {t('使用日志')} ({sortedLogs.length})
                </span>
              }
            >
              <div className="space-y-3">
                {sortedLogs.map((log, idx) => (
                  <div
                    key={idx}
                    className="border rounded-lg p-3 border-gray-200 dark:border-gray-700"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag
                        color={log.type === 2 ? 'green' : 'red'}
                        size="small"
                      >
                        {renderLogTypeName(log.type)}
                      </Tag>
                      <Text className="text-xs text-gray-500">
                        {log.created_at
                          ? timestamp2string(log.created_at)
                          : '-'}
                      </Text>
                      {log.channel && (
                        <Tag color="blue" size="small">
                          CH#{log.channel}
                        </Tag>
                      )}
                      <Text className="text-xs">{log.model_name || '-'}</Text>
                    </div>
                    {log.content && (
                      <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 truncate">
                        {log.content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default RequestTrace;
