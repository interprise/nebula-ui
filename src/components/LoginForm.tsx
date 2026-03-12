import React, { useState } from 'react';
import { Form, Input, Button, Card, Alert, Space } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';

interface LoginFormProps {
  onLogin: (username: string, password: string) => Promise<void>;
  error?: string;
  loading?: boolean;
  title?: string;
}

const LoginForm: React.FC<LoginFormProps> = ({ onLogin, error, loading, title }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = () => {
    if (username && password) {
      onLogin(username, password);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <img src="/entrasp/images/logos/logo_box.png" alt="Logo" style={{ height: 64 }} />
          {title && <div style={{ fontSize: 16, fontWeight: 500, marginTop: 8, color: '#333' }}>{title}</div>}
        </div>
        <Form onFinish={handleSubmit}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {error && <Alert type="error" message={error} showIcon />}
            <Form.Item>
              <Input
                prefix={<UserOutlined />}
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
              />
            </Form.Item>
            <Form.Item>
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              Accedi
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
};

export default LoginForm;
