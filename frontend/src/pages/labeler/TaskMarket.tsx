import { ClockCircleOutlined, FireOutlined, SearchOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, Input, Row, Select, Space, Tag, Typography } from 'antd';

/**
 * 任务市场。
 * 接口预留:GET /market/tasks(见 api/labeler.ts)。
 * 当前为 mock 卡片列表,后续阶段对接分页与筛选。
 */
const mockMarketTasks = [
  {
    id: 't-q12',
    title: 'QA 质量评估 · 批次 Q12',
    type: 'QA Quality',
    description: '判断模型回答的正确性、完整性,并标注潜在风险点。',
    remaining: 24,
    total: 50,
    deadline: '06-05 24:00',
    reward: 0.6,
  },
  {
    id: 't-p07',
    title: '偏好对比 A/B · 批次 P07',
    type: 'Preference Compare',
    description: '左右两段模型回答的偏好选择,标注强度与多维度标签。',
    remaining: 18,
    total: 30,
    deadline: '06-08 24:00',
    reward: 0.8,
  },
  {
    id: 't-img-04',
    title: '图像分类标注 · 交通标志 V4',
    type: 'Image Classification',
    description: '基于交通标志图像识别类别并补充模糊样本说明。',
    remaining: 96,
    total: 200,
    deadline: '06-10 24:00',
    reward: 0.3,
  },
];

const typeOptions = [
  { label: '全部类型', value: '' },
  { label: 'QA Quality', value: 'qa_quality' },
  { label: 'Preference Compare', value: 'preference_compare' },
  { label: 'Image Classification', value: 'image_classification' },
];

export default function TaskMarket() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>任务市场</Typography.Title>
          <Typography.Text type="secondary">
            浏览已发布任务并先到先得地认领标注名额。
          </Typography.Text>
        </Space>
      </div>

      <Card>
        <Space size="middle" wrap>
          <Input
            allowClear
            placeholder="搜索任务名称或关键词"
            prefix={<SearchOutlined />}
            style={{ width: 320 }}
          />
          <Select options={typeOptions} defaultValue="" style={{ width: 200 }} />
          <Button type="primary">筛选</Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {mockMarketTasks.map((task) => (
          <Col span={8} key={task.id}>
            <Card
              title={
                <Space size={8}>
                  {task.title}
                  <Tag color="blue">{task.type}</Tag>
                </Space>
              }
              extra={
                <Tag icon={<FireOutlined />} color="volcano">
                  ¥{task.reward.toFixed(2)} / 条
                </Tag>
              }
            >
              <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                {task.description}
              </Typography.Paragraph>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space size={16}>
                  <span>
                    剩余配额:<strong>{task.remaining}</strong> / {task.total}
                  </span>
                  <span>
                    <ClockCircleOutlined /> 截止 {task.deadline}
                  </span>
                </Space>
                <Button type="primary" block>
                  立即认领
                </Button>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      {mockMarketTasks.length === 0 && (
        <Empty description="暂无可认领的任务,请稍后再试。" />
      )}
    </Space>
  );
}
