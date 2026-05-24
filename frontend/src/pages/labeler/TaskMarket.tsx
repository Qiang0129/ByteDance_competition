import { useEffect, useState } from 'react';
import { ClockCircleOutlined, FireOutlined, SearchOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Empty, Input, Row, Select, Space, Tag, Typography } from 'antd';

import { labelerApi } from '../../api/labeler';
import type { MarketTask } from '../../types/labeler';

/**
 * 任务市场。
 * 接口预留:GET /market/tasks(见 api/labeler.ts)。
 * 当前已接入后端 GET /market/tasks,Owner 发布中的任务会同步展示。
 */
const typeOptions = [
  { label: '全部类型', value: '' },
  { label: 'QA Quality', value: 'qa_quality' },
  { label: 'Preference Compare', value: 'preference_compare' },
  { label: 'Image Classification', value: 'image_classification' },
];

export default function TaskMarket() {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [taskType, setTaskType] = useState('');
  const [tasks, setTasks] = useState<MarketTask[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void loadMarketTasks();
  }, []);

  async function loadMarketTasks() {
    setLoading(true);
    try {
      const response = await labelerApi.listMarketTasks({
        keyword: keyword || undefined,
        taskType: taskType || undefined,
        page: 1,
        pageSize: 20,
      });
      setTasks(response.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '任务市场加载失败');
    } finally {
      setLoading(false);
    }
  }

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
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onPressEnter={() => {
              void loadMarketTasks();
            }}
          />
          <Select
            options={typeOptions}
            value={taskType}
            onChange={setTaskType}
            style={{ width: 200 }}
          />
          <Button type="primary" loading={loading} onClick={() => void loadMarketTasks()}>
            筛选
          </Button>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {tasks.map((task) => (
          <Col span={8} key={task.taskId}>
            <Card
              loading={loading}
              title={
                <Space size={8}>
                  {task.title}
                  <Tag color="blue">{task.taskType}</Tag>
                </Space>
              }
              extra={
                <Tag icon={<FireOutlined />} color="volcano">
                  {formatReward(task.rewardPerItem)}
                </Tag>
              }
            >
              <Typography.Paragraph type="secondary" style={{ minHeight: 44 }}>
                {task.description}
              </Typography.Paragraph>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space size={16}>
                  <span>
                    剩余配额:<strong>{task.remainingQuota}</strong> / {task.totalQuota}
                  </span>
                  <span>
                    <ClockCircleOutlined /> 截止 {task.deadline || '未设置'}
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

      {!loading && tasks.length === 0 && (
        <Empty description="暂无可认领的任务,请稍后再试。" />
      )}
    </Space>
  );
}

function formatReward(rewardPerItem?: number) {
  return rewardPerItem == null ? '奖励待配置' : `¥${rewardPerItem.toFixed(2)} / 条`;
}
