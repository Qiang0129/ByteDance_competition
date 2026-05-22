import { Button, Result } from 'antd';
import { useNavigate } from 'react-router-dom';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请检查访问地址，或返回登录页重新选择角色。"
      extra={
        <Button type="primary" onClick={() => navigate('/login')}>
          返回登录页
        </Button>
      }
    />
  );
}
