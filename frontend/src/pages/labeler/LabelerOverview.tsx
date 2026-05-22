import {
  CheckOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  RightOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';

/**
 * 标注员工作台概览页(Dashboard)。
 * 数据均为前端 mock,接口待 Spring Boot 端 /market/tasks 和 /assignments/mine 完成后接入。
 */
const recentBatches = [
  {
    title: 'QA 质量评估 · 批次 Q12',
    description: '问答正确性 / 完整性 / 风险三维度评估,剩余 24 条待标注。',
    tag: 'QA Quality',
    quota: '24 / 50',
  },
  {
    title: '偏好对比 A/B · 批次 P07',
    description: '同一 Prompt 下两条模型回答的偏好选择与强度判断。',
    tag: 'Preference Compare',
    quota: '18 / 30',
  },
];

export default function LabelerOverview() {
  const navigate = useNavigate();

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>工作概览</Typography.Title>
          <Typography.Text type="secondary">
            浏览任务市场、跟踪标注进度并处理被打回的作业。
          </Typography.Text>
        </Space>
        <Button type="primary" icon={<ShopOutlined />} onClick={() => navigate('/labeler/market')}>
          进入任务市场
        </Button>
      </div>

      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title="进行中任务" value={5} prefix={<FileTextOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="今日已提交" value={26} prefix={<CheckOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待修改打回" value={2} prefix={<ExclamationCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="平均耗时/条" value={18} suffix="秒" prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={14}>
          <Card
            title="最近的任务批次"
            extra={
              <Button type="link" onClick={() => navigate('/labeler/my-tasks')}>
                查看全部 <RightOutlined />
              </Button>
            }
          >
            <List
              dataSource={recentBatches}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button key="enter" type="link">
                      进入答题
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
                    description={`${item.description} 进度 ${item.quota}`}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="近日提交进度">
            <Space direction="vertical" size="large" className="page-stack">
              <Progress percent={42} status="active" />
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="标注画布将在动态表单阶段接入 Renderer"
              />
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
