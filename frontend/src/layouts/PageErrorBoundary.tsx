import { Component } from 'react';
import type { ReactNode } from 'react';
import { Button, Result } from 'antd';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 内容区错误边界。
 * 子页面渲染抛异常时,只把内容区降级为错误提示,而不是整个 React 树被卸掉变白屏。
 * 侧栏、顶栏、面包屑保持可用,用户可以切到其它页面继续工作。
 */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // 仅 dev 时打印,production 由集中日志系统接管
    if (import.meta.env.DEV) {
      console.error('[PageErrorBoundary]', error, info);
    }
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <Result
          status="500"
          title="页面渲染出现异常"
          subTitle={this.state.error.message || '请刷新或返回上一步重试。'}
          extra={
            <Button type="primary" onClick={this.reset}>
              重试当前页面
            </Button>
          }
        />
      );
    }
    return this.props.children;
  }
}
