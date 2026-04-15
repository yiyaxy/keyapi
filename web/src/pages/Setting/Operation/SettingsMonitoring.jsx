/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Button,
  Col,
  Form,
  Row,
  Spin,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
  parseHttpStatusCodeRules,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';
import HttpStatusCodeRulesInput from '../../../components/settings/HttpStatusCodeRulesInput';

export default function SettingsMonitoring(props) {
  const { t } = useTranslation();
  const { Text } = Typography;
  const [loading, setLoading] = useState(false);
  const [channelLoading, setChannelLoading] = useState(false);
  const [allChannels, setAllChannels] = useState([]);
  const [channelSearchText, setChannelSearchText] = useState('');
  const [inputs, setInputs] = useState({
    ChannelDisableThreshold: '',
    QuotaRemindThreshold: '',
    AutomaticDisableChannelEnabled: false,
    AutomaticEnableChannelEnabled: false,
    AutomaticDisableKeywords: '',
    AutomaticDisableStatusCodes: '401',
    AutomaticRetryStatusCodes:
      '100-199,300-399,401-407,409-499,500-503,505-523,525-599',
    'monitor_setting.auto_test_channel_enabled': false,
    'monitor_setting.auto_test_channel_minutes': 10,
    ChannelMonitorVisibility: '{"hidden_channel_ids":[]}',
  });
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);
  const parsedAutoDisableStatusCodes = parseHttpStatusCodeRules(
    inputs.AutomaticDisableStatusCodes || '',
  );
  const parsedMonitorVisibility = useMemo(() => {
    try {
      const parsed = JSON.parse(inputs.ChannelMonitorVisibility || '{}');
      const hiddenIds = Array.isArray(parsed?.hidden_channel_ids)
        ? parsed.hidden_channel_ids
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id))
        : [];
      return { ok: true, hiddenChannelIds: hiddenIds };
    } catch (error) {
      return { ok: false, hiddenChannelIds: [] };
    }
  }, [inputs.ChannelMonitorVisibility]);

  const visibleChannels = useMemo(() => {
    const keyword = channelSearchText.trim().toLowerCase();
    const selectedIds = new Set(parsedMonitorVisibility.hiddenChannelIds);
    const matches = keyword
      ? allChannels.filter((channel) => {
          const name = String(channel.name || '').toLowerCase();
          const baseURL = String(channel.base_url || '').toLowerCase();
          return name.includes(keyword) || baseURL.includes(keyword);
        })
      : allChannels;

    return [...matches].sort((a, b) => {
      const aSelected = selectedIds.has(Number(a.id)) ? 1 : 0;
      const bSelected = selectedIds.has(Number(b.id)) ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      return Number(a.id) - Number(b.id);
    });
  }, [allChannels, channelSearchText, parsedMonitorVisibility.hiddenChannelIds]);

  const hiddenChannelIdsValue = parsedMonitorVisibility.hiddenChannelIds.map(String);

  const updateMonitorVisibility = (hiddenChannelIds) => {
    const normalized = Array.from(
      new Set(
        (hiddenChannelIds || [])
          .map((id) => Number(id))
          .filter((id) => Number.isInteger(id)),
      ),
    ).sort((a, b) => a - b);

    setInputs({
      ...inputs,
      ChannelMonitorVisibility: JSON.stringify({
        hidden_channel_ids: normalized,
      }),
    });
  };

  const toggleHiddenChannel = (channelId) => {
    const nextHiddenIds = new Set(parsedMonitorVisibility.hiddenChannelIds);
    if (nextHiddenIds.has(channelId)) {
      nextHiddenIds.delete(channelId);
    } else {
      nextHiddenIds.add(channelId);
    }
    updateMonitorVisibility(Array.from(nextHiddenIds));
  };

  const fetchChannels = async () => {
    try {
      setChannelLoading(true);
      const res = await API.get('/api/channel/?p=0&page_size=1000&id_sort=true');
      const { success, message, data } = res.data;
      if (!success) {
        showError(message);
        return;
      }
      setAllChannels(data?.items || []);
    } catch (error) {
      showError(t('获取渠道失败：') + error.message);
    } finally {
      setChannelLoading(false);
    }
  };

  const parsedAutoRetryStatusCodes = parseHttpStatusCodeRules(
    inputs.AutomaticRetryStatusCodes || '',
  );

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    if (!parsedAutoDisableStatusCodes.ok) {
      const details =
        parsedAutoDisableStatusCodes.invalidTokens &&
        parsedAutoDisableStatusCodes.invalidTokens.length > 0
          ? `: ${parsedAutoDisableStatusCodes.invalidTokens.join(', ')}`
          : '';
      return showError(`${t('自动禁用状态码格式不正确')}${details}`);
    }
    if (!parsedAutoRetryStatusCodes.ok) {
      const details =
        parsedAutoRetryStatusCodes.invalidTokens &&
        parsedAutoRetryStatusCodes.invalidTokens.length > 0
          ? `: ${parsedAutoRetryStatusCodes.invalidTokens.join(', ')}`
          : '';
      return showError(`${t('自动重试状态码格式不正确')}${details}`);
    }
    if (!parsedMonitorVisibility.ok) {
      return showError(t('渠道监控可见性配置格式不正确'));
    }
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (typeof inputs[item.key] === 'boolean') {
        value = String(inputs[item.key]);
      } else {
        const normalizedMap = {
          AutomaticDisableStatusCodes: parsedAutoDisableStatusCodes.normalized,
          AutomaticRetryStatusCodes: parsedAutoRetryStatusCodes.normalized,
          ChannelMonitorVisibility: JSON.stringify({
            hidden_channel_ids: parsedMonitorVisibility.hiddenChannelIds,
          }),
        };
        value = normalizedMap[item.key] ?? inputs[item.key];
      }
      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchChannels();
  }, []);

  useEffect(() => {
    const currentInputs = {
      ...inputs,
      ChannelMonitorVisibility:
        inputs.ChannelMonitorVisibility || '{"hidden_channel_ids":[]}',
    };
    for (let key in props.options) {
      if (Object.keys(inputs).includes(key)) {
        if (key === 'ChannelMonitorVisibility') {
          try {
            const parsed = JSON.parse(
              props.options[key] || '{"hidden_channel_ids":[]}',
            );
            currentInputs[key] = JSON.stringify({
              hidden_channel_ids: Array.isArray(parsed?.hidden_channel_ids)
                ? parsed.hidden_channel_ids
                    .map((id) => Number(id))
                    .filter((id) => Number.isInteger(id))
                : [],
            });
          } catch (error) {
            currentInputs[key] = props.options[key] || '{"hidden_channel_ids":[]}';
          }
        } else {
          currentInputs[key] = props.options[key];
        }
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    refForm.current.setValues(currentInputs);
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('监控设置')}>
            <Row gutter={16}>
              <Col xs={24} sm={24} md={16} lg={16} xl={16}>
                <Form.Select
                  field={'ChannelMonitorVisibilityHiddenIds'}
                  label={t('监控隐藏渠道')}
                  placeholder={t('搜索并选择需要在监控页隐藏的渠道')}
                  extraText={t(
                    '这里选中的渠道会从通道监控页面隐藏，不影响实际渠道配置与请求转发。',
                  )}
                  multiple
                  filter
                  searchPosition='dropdown'
                  loading={channelLoading}
                  value={hiddenChannelIdsValue}
                  onSearch={setChannelSearchText}
                  onChange={(value) => updateMonitorVisibility(value || [])}
                  optionList={visibleChannels.map((channel) => ({
                    value: String(channel.id),
                    label: `${channel.name || '-'} (#${channel.id})`,
                  }))}
                  renderSelectedItem={(optionNode) => optionNode}
                />
                <div style={{ marginTop: 8 }}>
                  <Text type='tertiary' size='small'>
                    {t('已隐藏渠道数')}：{parsedMonitorVisibility.hiddenChannelIds.length}
                  </Text>
                </div>
              </Col>
              <Col xs={24} sm={24} md={8} lg={8} xl={8}>
                <div style={{ marginTop: 28 }}>
                  <Button
                    type='tertiary'
                    onClick={() => updateMonitorVisibility([])}
                    disabled={parsedMonitorVisibility.hiddenChannelIds.length === 0}
                  >
                    {t('清空监控隐藏渠道')}
                  </Button>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {parsedMonitorVisibility.hiddenChannelIds.slice(0, 8).map((id) => (
                    <Tag
                      key={id}
                      closable
                      onClose={(e) => {
                        e.preventDefault();
                        toggleHiddenChannel(id);
                      }}
                    >
                      #{id}
                    </Tag>
                  ))}
                  {parsedMonitorVisibility.hiddenChannelIds.length > 8 && (
                    <Tag color='grey'>
                      +{parsedMonitorVisibility.hiddenChannelIds.length - 8}
                    </Tag>
                  )}
                </div>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'monitor_setting.auto_test_channel_enabled'}
                  label={t('定时测试所有通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.auto_test_channel_enabled': value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('自动测试所有通道间隔时间')}
                  step={1}
                  min={1}
                  suffix={t('分钟')}
                  extraText={t('每隔多少分钟测试一次所有通道')}
                  placeholder={''}
                  field={'monitor_setting.auto_test_channel_minutes'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      'monitor_setting.auto_test_channel_minutes':
                        parseInt(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('测试所有渠道的最长响应时间')}
                  step={1}
                  min={0}
                  suffix={t('秒')}
                  extraText={t(
                    '当运行通道全部测试时，超过此时间将自动禁用通道',
                  )}
                  placeholder={''}
                  field={'ChannelDisableThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      ChannelDisableThreshold: String(value),
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.InputNumber
                  label={t('额度提醒阈值')}
                  step={1}
                  min={0}
                  suffix={'Token'}
                  extraText={t('低于此额度时将发送邮件提醒用户')}
                  placeholder={''}
                  field={'QuotaRemindThreshold'}
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      QuotaRemindThreshold: String(value),
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'AutomaticDisableChannelEnabled'}
                  label={t('失败时自动禁用通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      AutomaticDisableChannelEnabled: value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'AutomaticEnableChannelEnabled'}
                  label={t('成功时自动启用通道')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      AutomaticEnableChannelEnabled: value,
                    })
                  }
                />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <HttpStatusCodeRulesInput
                  label={t('自动禁用状态码')}
                  placeholder={t('例如：401, 403, 429, 500-599')}
                  extraText={t(
                    '支持填写单个状态码或范围（含首尾），使用逗号分隔',
                  )}
                  field={'AutomaticDisableStatusCodes'}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticDisableStatusCodes: value })
                  }
                  parsed={parsedAutoDisableStatusCodes}
                  invalidText={t('自动禁用状态码格式不正确')}
                />
                <HttpStatusCodeRulesInput
                  label={t('自动重试状态码')}
                  placeholder={t('例如：401, 403, 429, 500-599')}
                  extraText={t(
                    '支持填写单个状态码或范围（含首尾），使用逗号分隔；504 和 524 始终不重试，不受此处配置影响',
                  )}
                  field={'AutomaticRetryStatusCodes'}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticRetryStatusCodes: value })
                  }
                  parsed={parsedAutoRetryStatusCodes}
                  invalidText={t('自动重试状态码格式不正确')}
                />
                <Form.TextArea
                  label={t('自动禁用关键词')}
                  placeholder={t('一行一个，不区分大小写')}
                  extraText={t(
                    '当上游通道返回错误中包含这些关键词时（不区分大小写），自动禁用通道',
                  )}
                  field={'AutomaticDisableKeywords'}
                  autosize={{ minRows: 6, maxRows: 12 }}
                  onChange={(value) =>
                    setInputs({ ...inputs, AutomaticDisableKeywords: value })
                  }
                />
              </Col>
            </Row>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存监控设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
