import React, { useState } from 'react';
import { Modal, Form, Input, Button } from 'antd';
import * as api from '../services/api';
import type { ErrorItem } from '../types/ui';

interface ChangePasswordModalProps {
  open: boolean;
  onClose: () => void;
  /** Surface server-side errors (wrong current password, policy, …). */
  onServerErrors: (errors: ErrorItem[]) => void;
}

interface PwdValues {
  oldpwd?: string;
  newpwd: string;
  newpwd2: string;
}

/**
 * Change-password dialog with inline client validation.
 *
 * Previously a `modal.confirm` whose onOk threw to keep itself open on invalid
 * input — but a toast raised inside a rejecting modal.confirm onOk is reconciled
 * away by the modal's own re-render, so validation feedback never showed. This
 * controlled <Modal> + <Form> keeps required/match errors inline (which always
 * render), and closing is fully driven by state via a custom footer so an
 * invalid or server-rejected submit never auto-closes the dialog. (SXADV-5542)
 */
const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ open, onClose, onServerErrors }) => {
  const [form] = Form.useForm<PwdValues>();
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    form.resetFields();
    onClose();
  };

  // Only runs after client-side validation passes (Form.onFinish).
  const handleFinish = async (values: PwdValues) => {
    setSubmitting(true);
    try {
      const resp = await api.postAction2('ChangePassword2', {
        oldpwd: values.oldpwd ?? '',
        newpwd: values.newpwd,
        newpwd2: values.newpwd2,
      });
      if (resp.errors && resp.errors.length > 0) {
        onServerErrors(resp.errors);
        if (resp.errors.some((e) => e.type === 'ERROR')) return; // keep the dialog open
      }
      close();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Cambio Password"
      open={open}
      onCancel={close}
      mask={{ closable: false }}
      footer={[
        <Button key="cancel" onClick={close}>Annulla</Button>,
        <Button key="ok" type="primary" loading={submitting} onClick={() => form.submit()}>
          Cambia Password
        </Button>,
      ]}
    >
      <Form form={form} onFinish={handleFinish} style={{ marginTop: 8 }}>
        <Form.Item name="oldpwd" style={{ marginBottom: 12 }}>
          <Input.Password placeholder="Password attuale" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newpwd"
          style={{ marginBottom: 12 }}
          rules={[{ required: true, message: 'Inserire la nuova password' }]}
        >
          <Input.Password placeholder="Nuova password" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="newpwd2"
          style={{ marginBottom: 0 }}
          dependencies={['newpwd']}
          rules={[
            { required: true, message: 'Ripetere la nuova password' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                if (!value || getFieldValue('newpwd') === value) return Promise.resolve();
                return Promise.reject(new Error('Le password non coincidono'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="Ripeti nuova password" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ChangePasswordModal;
