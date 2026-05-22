import { CheckOutlined, ClockCircleOutlined, FileTextOutlined } from '@ant-design/icons';
import { Button, Card, Col, Empty, List, Progress, Row, Space, Statistic, Tag, Typography } from 'antd';

const taskBatches = [
  {
    title: '交通标志图片分类',
    description: '请根据图片内容选择对应交通标志类别。',
    count: 48,
    tag: '图像分类',
  },
  {
    title: '商户评论情感标注',
    description: '判断评论文本的正向、中性或负向情绪。',
    count: 32,
    tag: '文本分类',
  },
];

export default function LabelerHome() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>标注员工作台</Typography.Title>
          <Typography.Text type="secondary">
            查看已分配任务，进入标注页面，并提交待审核结果。
          </Typography.Text>
        </Space>
        <Button type="primary">开始标注</Button>
      </div>

      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="待标注任务" value={80} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="今日已完成" value={26} prefix={<CheckOutlined />} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="平均耗时/条" value={18} suffix="秒" prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={14}>
          <Card title="任务队列">
            <List
              dataSource={taskBatches}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="enter" type="link">
                      进入任务
                    </Button>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        {item.title}
                        <Tag color="blue">{item.tag}</Tag>
                      </Space>
                    }
                    description={`${item.description} 剩余 ${item.count} 条`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="标注进度">
            <Space direction="vertical" size="large" className="page-stack">
              <Progress percent={42} status="active" />
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="标注画布将在后续阶段接入任务数据与动态表单"
              />
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
