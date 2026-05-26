import {
  CheckCircleFilled,
  CloseCircleFilled,
  DownloadOutlined,
  ExclamationCircleFilled,
  RobotOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Row, Space, Tag, Typography } from 'antd';

/**
 * 审核报表(占位骨架)。
 * 真实数据由 GET /reviewer/reports 提供;计划书 4.6 重点指标:
 *   - 审核通过率 / 打回率 / 双审一致率
 *   - 各任务类型的争议数趋势
 *   - 审核员人均处理量
 */

const stats = [
  { key: 'approve', label: '通过率', value: '92.3%', color: '#22c55e', icon: <CheckCircleFilled /> },
  { key: 'return', label: '打回率', value: '6.1%', color: '#f59e0b', icon: <CloseCircleFilled /> },
  { key: 'dispute', label: '争议率', value: '1.6%', color: '#ef4444', icon: <ExclamationCircleFilled /> },
  { key: 'ai', label: 'AI 一致率', value: '88.4%', color: '#2f7bff', icon: <RobotOutlined /> },
];

const trend = [
  { month: 'Jan', approve: 86, return: 9, dispute: 5 },
  { month: 'Feb', approve: 88, return: 8, dispute: 4 },
  { month: 'Mar', approve: 89, return: 7, dispute: 4 },
  { month: 'Apr', approve: 90, return: 6, dispute: 4 },
  { month: 'May', approve: 92, return: 6, dispute: 2 },
];

export default function ReviewerReports() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>审核报表</Typography.Title>
          <Typography.Text type="secondary">
            通过率 / 打回率 / 争议率 / AI 一致率,后续接入 GET /reviewer/reports 实时拉取。
          </Typography.Text>
        </Space>
        <Button icon={<DownloadOutlined />}>导出 CSV</Button>
      </div>

      <Row gutter={[16, 16]}>
        {stats.map((s) => (
          <Col xs={12} md={6} key={s.key}>
            <Card className="reviewer-kpi">
              <div
                className="reviewer-kpi-icon"
                style={{ background: `${s.color}15`, color: s.color }}
              >
                {s.icon}
              </div>
              <div className="reviewer-kpi-value">{s.value}</div>
              <div className="reviewer-kpi-title">{s.label}</div>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={16}>
          <Card title="近 5 个月审核结果分布">
            <div className="bar-chart">
              <div className="bar-chart-y">
                {[100, 80, 60, 40, 20, 0].map((tick) => (
                  <span key={tick}>{tick}%</span>
                ))}
              </div>
              <div className="bar-chart-area attendance">
                {trend.map((t) => {
                  const total = t.approve + t.return + t.dispute || 1;
                  return (
                    <div key={t.month} className="bar-group attendance-group">
                      <div className="bar-stack attendance-stack">
                        <div className="bar-seg absent" style={{ height: `${(t.dispute / total) * 100}%` }} />
                        <div className="bar-seg late" style={{ height: `${(t.return / total) * 100}%` }} />
                        <div className="bar-seg ontime" style={{ height: `${(t.approve / total) * 100}%` }} />
                      </div>
                      <div className="bar-label">{t.month}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="bar-legend">
              <span>
                <i className="dot" style={{ background: '#2f7bff' }} />通过
              </span>
              <span>
                <i className="dot" style={{ background: '#f59e0b' }} />打回
              </span>
              <span>
                <i className="dot" style={{ background: '#94a3b8' }} />争议
              </span>
            </div>
          </Card>
        </Col>

        <Col xs={24} xl={8}>
          <Card title="后端接口预留">
            <Typography.Paragraph type="secondary">
              下列接口将在后端实现后接入,前端调用入口已经在 <code>api/reviewer.ts</code> 留好。
            </Typography.Paragraph>
            <Space direction="vertical" size={6}>
              <Tag color="blue">GET /reviewer/reports?range=30d</Tag>
              <Tag color="blue">GET /reviewer/reports/labelers</Tag>
              <Tag color="blue">GET /reviewer/reports/tasks</Tag>
              <Tag color="green">GET /reviewer/audit-log</Tag>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
