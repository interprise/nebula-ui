import React, { useState } from 'react';
import { Modal, Form, Input, Button } from 'antd';
import * as api from '../services/api';

interface ImpersonateModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after a successful impersonation (reload menu + refresh view). */
  onSuccess: () => void;
}

interface ImpersonateValues {
  username: string;
}

/**
 * "Impersona un utente" dialog. Controlled <Modal> + <Form> so the "user not
 * found" error renders inline on the field — a toast raised inside the old
 * modal.confirm onOk was reconciled away (SXADV-5542). Closing is driven by
 * state via a custom footer so a failed lookup keeps the dialog open. Enter
 * submits the form.
 */
const ImpersonateModal: React.FC<ImpersonateModalProps> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm<ImpersonateValues>();
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    form.resetFields();
    onClose();
  };

  const handleFinish = async (values: ImpersonateValues) => {
    const username = values.username.trim();
    setSubmitting(true);
    try {
      const resp = await api.postAction2('Impersonate', { username });
      const r = resp as unknown as { errors?: unknown[] };
      if (r.errors && r.errors.length > 0) {
        form.setFields([{ name: 'username', errors: ['Utente non trovato'] }]);
        return; // keep the dialog open
      }
      close();
      onSuccess();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Impersona un utente"
      open={open}
      onCancel={close}
      mask={{ closable: false }}
      footer={[
        <Button key="cancel" onClick={close}>Annulla</Button>,
        <Button key="ok" type="primary" loading={submitting} onClick={() => form.submit()}>
          Impersona
        </Button>,
      ]}
    >
      <Form form={form} onFinish={handleFinish} style={{ marginTop: 8 }}>
        <Form.Item
          name="username"
          style={{ marginBottom: 0 }}
          rules={[
            { required: true, message: 'Inserire uno username' },
            { whitespace: true, message: 'Inserire uno username' },
          ]}
        >
          <Input placeholder="Username" autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default ImpersonateModal;
