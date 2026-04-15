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

import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button, Card, Col, Form, Radio, Row, Spin } from '@douyinfe/semi-ui';
import { API, showError, showSuccess, toBoolean } from '../../../helpers';
import { useTranslation } from 'react-i18next';

export default function SettingsInvoice(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState({
    InvoiceProvider: 'manual',
    InvoiceAutoIssueEnabled: false,
    InvoicePiaoTongBaseURL: '',
    InvoicePiaoTongPlatformCode: '',
    InvoicePiaoTongPlatformAlias: '',
    InvoicePiaoTong3DESKey: '',
    InvoicePiaoTongPrivateKey: '',
    InvoicePiaoTongPublicKey: '',
    InvoiceSellerTaxpayerNum: '',
    InvoiceSellerEnterpriseName: '',
    InvoiceDefaultIssueKindCode: '82',
    InvoiceDefaultTaxClassificationCode: '',
    InvoiceDefaultGoodsName: '技术服务费',
    InvoiceDefaultTaxRateValue: '0.01',
    InvoiceDefaultPaymentCode: '',
    InvoiceDefaultSubMchid: '',
    InvoiceDefaultAccount: '',
    InvoiceQueryRetryIntervalSeconds: '60',
    InvoiceQueryMaxAttempts: '60',
  });
  const formApiRef = useRef(null);

  useEffect(() => {
    if (!props.options) return;
    const next = { ...inputs };
    Object.keys(next).forEach((key) => {
      if (props.options[key] !== undefined) {
        next[key] = key === 'InvoiceAutoIssueEnabled' ? toBoolean(props.options[key]) : props.options[key];
      }
    });
    setInputs(next);
    formApiRef.current?.setValues(next);
  }, [props.options]);

  const handleFormChange = (values) => {
    setInputs((prev) => ({ ...prev, ...values }));
  };

  const updateOptions = async (options) => {
    setLoading(true);
    try {
      await Promise.all(
        options.map((opt) =>
          API.put('/api/option/', {
            key: opt.key,
            value: typeof opt.value === 'boolean' ? String(opt.value) : opt.value,
          }),
        ),
      );
      showSuccess(t('更新成功'));
      props.refresh?.();
    } catch (error) {
      showError(t('更新失败'));
    } finally {
      setLoading(false);
    }
  };

  const submitInvoiceSettings = async () => {
    // Sensitive fields (ending with Key) are hidden by the backend API for security.
    // Only send them if the user has actually entered a new value; empty means "keep existing".
    const sensitiveKeys = ['InvoicePiaoTong3DESKey', 'InvoicePiaoTongPrivateKey', 'InvoicePiaoTongPublicKey'];
    const allOptions = [
      { key: 'InvoiceProvider', value: inputs.InvoiceProvider },
      { key: 'InvoiceAutoIssueEnabled', value: inputs.InvoiceAutoIssueEnabled },
      { key: 'InvoicePiaoTongBaseURL', value: inputs.InvoicePiaoTongBaseURL },
      { key: 'InvoicePiaoTongPlatformCode', value: inputs.InvoicePiaoTongPlatformCode },
      { key: 'InvoicePiaoTongPlatformAlias', value: inputs.InvoicePiaoTongPlatformAlias },
      { key: 'InvoicePiaoTong3DESKey', value: inputs.InvoicePiaoTong3DESKey },
      { key: 'InvoicePiaoTongPrivateKey', value: inputs.InvoicePiaoTongPrivateKey },
      { key: 'InvoicePiaoTongPublicKey', value: inputs.InvoicePiaoTongPublicKey },
      { key: 'InvoiceSellerTaxpayerNum', value: inputs.InvoiceSellerTaxpayerNum },
      { key: 'InvoiceSellerEnterpriseName', value: inputs.InvoiceSellerEnterpriseName },
      { key: 'InvoiceDefaultIssueKindCode', value: inputs.InvoiceDefaultIssueKindCode },
      { key: 'InvoiceDefaultTaxClassificationCode', value: inputs.InvoiceDefaultTaxClassificationCode },
      { key: 'InvoiceDefaultGoodsName', value: inputs.InvoiceDefaultGoodsName },
      { key: 'InvoiceDefaultTaxRateValue', value: inputs.InvoiceDefaultTaxRateValue },
      { key: 'InvoiceDefaultPaymentCode', value: inputs.InvoiceDefaultPaymentCode },
      { key: 'InvoiceDefaultSubMchid', value: inputs.InvoiceDefaultSubMchid },
      { key: 'InvoiceDefaultAccount', value: inputs.InvoiceDefaultAccount },
      { key: 'InvoiceQueryRetryIntervalSeconds', value: inputs.InvoiceQueryRetryIntervalSeconds },
      { key: 'InvoiceQueryMaxAttempts', value: inputs.InvoiceQueryMaxAttempts },
    ];
    // Filter out sensitive fields that are empty (not modified by user)
    const filtered = allOptions.filter((opt) => {
      if (sensitiveKeys.includes(opt.key)) {
        return String(opt.value || '').trim() !== '';
      }
      return true;
    });
    await updateOptions(filtered);
  };

  return (
    <Spin spinning={loading}>
      <Card>
        <Form initValues={inputs} onValueChange={handleFormChange} getFormApi={(api) => (formApiRef.current = api)}>
          <Form.Section text={t('发票设置')}>
            <Banner
              type='info'
              description={t('票通变量放在系统设置下统一管理；手动模式保留现有人工上传附件流程，票通模式支持审批后手动或自动开票。')}
              style={{ marginBottom: 16 }}
            />
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Select
                  field='InvoiceProvider'
                  label={t('开票提供方')}
                  optionList={[
                    { value: 'manual', label: t('人工处理') },
                    { value: 'piaotong', label: t('票通数电发票') },
                  ]}
                />
              </Col>
              <Col xs={24} md={12}>
                <Form.Checkbox field='InvoiceAutoIssueEnabled' noLabel>
                  {t('审批通过后自动调用票通开票')}
                </Form.Checkbox>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoicePiaoTongBaseURL' label={t('票通基础地址')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoicePiaoTongPlatformCode' label={t('平台编码')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoicePiaoTongPlatformAlias' label={t('平台前缀')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoiceSellerTaxpayerNum' label={t('销方税号')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoiceSellerEnterpriseName' label={t('销方企业名称')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultIssueKindCode' label={t('默认票种编码')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultTaxClassificationCode' label={t('默认税收分类编码')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultGoodsName' label={t('默认商品名称')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultTaxRateValue' label={t('默认税率')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoiceQueryRetryIntervalSeconds' label={t('查询间隔秒数')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultPaymentCode' label={t('默认支付编码')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultSubMchid' label={t('默认子商户号')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoiceDefaultAccount' label={t('默认账户')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoiceQueryMaxAttempts' label={t('最大查询次数')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoicePiaoTongPublicKey' label={t('票通公钥')} placeholder={t('敏感信息已隐藏，留空保持不变')} /></Col>
              <Col xs={24} md={12}><Form.Input field='InvoicePiaoTong3DESKey' label={t('3DES 密钥')} type='password' placeholder={t('敏感信息已隐藏，留空保持不变')} /></Col>
            </Row>
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field='InvoicePiaoTongPrivateKey' label={t('RSA 私钥')} type='password' placeholder={t('敏感信息已隐藏，留空保持不变')} /></Col>
            </Row>
            <Button onClick={submitInvoiceSettings}>{t('更新发票设置')}</Button>
          </Form.Section>
        </Form>
      </Card>
    </Spin>
  );
}
