import { AuditOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Button, Card, Col, List, Row, Space, Statistic, Tag, Typography } from 'antd';

const reviewItems = [
  {
    title: '交通标志图片分类 - 批次 A12',
    description: '抽检 50 条，其中 4 条需要人工复核。',
    priority: '高优先级',
  },
  {
    title: '商户评论情感标注 - 批次 T07',
    description: '待审核 36 条，需确认争议样本。',
    priority: '普通',
  },
];

export default function ReviewerHome() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>审核员工作台</Typography.Title>
          <Typography.Text type="secondary">
            审核标注结果、处理争议样本，并沉淀质量反馈。
          </Typography.Text>
        </Space>
        <Button type="primary">领取审核任务</Button>
      </div>

      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="待审核批次" value={7} prefix={<AuditOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="今日通过" value={112} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="今日驳回" value={9} prefix={<CloseCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="待审核队列">
            <List
              dataSource={reviewItems}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="review" type="link">
                      开始审核
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        {item.title}
                        <Tag color={item.priority === '高优先级' ? 'red' : 'default'}>
                          {item.priority}
                        </Tag>
                      </Space>
                    }
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="质量规则预留">
            <Typography.Paragraph type="secondary">
              后续后端可提供审核规则、抽检比例、争议样本列表和审核结论提交接口。
            </Typography.Paragraph>
            <Space wrap>
              <Tag color="blue">GET /api/reviewer/tasks</Tag>
              <Tag color="green">POST /api/reviewer/reviews</Tag>
              <Tag color="orange">GET /api/reviewer/disputes</Tag>
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
