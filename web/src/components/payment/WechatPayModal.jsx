import React, { useEffect, useState, useRef } from 'react';
import { Modal, Typography, Toast, Spin } from '@douyinfe/semi-ui';
import { QRCodeCanvas } from 'qrcode.react';
import { getPaymentOrder } from '../../helpers/payment';

const { Text } = Typography;

// WechatPayModal opens a modal with the WeChat Pay Native QR and polls
// /api/payment/orders/:out_trade_no every 3 seconds until status !=
// 'pending' or the modal is closed.
//
// Props:
//   visible, onClose, codeUrl, outTradeNo, amountCents, onSuccess (optional),
//   title (optional)
export default function WechatPayModal({
  visible, onClose, codeUrl, outTradeNo, amountCents, title = '微信支付', onSuccess,
}) {
  const [status, setStatus] = useState('pending');
  const pollRef = useRef(null);

  useEffect(() => {
    if (!visible || !outTradeNo) return undefined;
    setStatus('pending');
    pollRef.current = setInterval(async () => {
      try {
        const res = await getPaymentOrder(outTradeNo);
        const s = res?.data?.status;
        if (!s) return;
        setStatus(s);
        if (s !== 'pending') {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (s === 'paid' || s === 'partial_refunded' || s === 'fully_refunded') {
            Toast.success('支付成功');
            if (onSuccess) onSuccess();
            onClose?.();
          } else if (s === 'closed' || s === 'expired') {
            Toast.info(`订单已${s === 'expired' ? '过期' : '关闭'}`);
            onClose?.();
          }
        }
      } catch (_) { /* transient — next tick retries */ }
    }, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [visible, outTradeNo, onClose, onSuccess]);

  return (
    <Modal
      title={title}
      visible={visible}
      onCancel={onClose}
      footer={null}
      width={360}
    >
      <div style={{ textAlign: 'center', padding: '16px 0' }}>
        {codeUrl ? (
          <QRCodeCanvas value={codeUrl} size={240} />
        ) : (
          <Spin />
        )}
        <div style={{ marginTop: 16 }}>
          <Text>{`订单号: ${outTradeNo || '-'}`}</Text>
        </div>
        <div>
          <Text>{`金额: ¥${((amountCents || 0) / 100).toFixed(2)}`}</Text>
        </div>
        <div style={{ marginTop: 12 }}>
          <Text type="tertiary">
            {status === 'pending' ? '请使用微信扫码支付...' : `状态: ${status}`}
          </Text>
        </div>
      </div>
    </Modal>
  );
}
