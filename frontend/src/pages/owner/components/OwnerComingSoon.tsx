import { ToolOutlined } from '@ant-design/icons';
import { Card, Space, Tag, Typography } from 'antd';

interface OwnerComingSoonProps {
  /** 页面标题 */
  title: string;
  /** 一句话描述,直接抄计划书章节即可 */
  description: string;
  /** 计划书阶段标识,如 Phase 2 / Phase 3 */
  phase?: string;
  /** 后端预留接口列表,展示给团队对齐 */
  apis?: string[];
}

/**
 * Owner 端二级页面统一骨架。
 * 当前阶段先占位,后续阶段按计划书逐项落地;
 * 文案与 API 路径直接来自《项目实施计划书》,避免 mock 漂移。
 */
export default function OwnerComingSoon({
  title,
  description,
  phase = 'Phase 2 · 后续阶段',
  apis = [],
}: OwnerComingSoonProps) {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </Space>
        <Tag color="processing">{phase}</Tag>
      </div>

      <Card className="owner-coming-soon">
        <div className="owner-coming-icon">
          <ToolOutlined />
        </div>
        <Typography.Title level={4} style={{ marginBottom: 8 }}>
          页面骨架已就绪,等待后端接入
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ maxWidth: 520, margin: '0 auto' }}>
          {description}
        </Typography.Paragraph>

        {apis.length > 0 && (
          <div className="owner-coming-apis">
            <Typography.Text type="secondary">预留接口:</Typography.Text>
            <Space size={[8, 8]} wrap>
              {apis.map((api) => (
                <Tag key={api} color="blue">
                  {api}
                </Tag>
              ))}
            </Space>
          </div>
        )}
      </Card>
    </Space>
  );
}
