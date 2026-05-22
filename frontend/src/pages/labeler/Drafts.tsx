import { CloudSyncOutlined, DeleteOutlined } from '@ant-design/icons';
import { Button, Card, List, Space, Tag, Typography } from 'antd';

/**
 * 草稿箱。
 * 接口预留:GET /assignments/{id}/draft、PUT /assignments/{id}/draft(见 api/labeler.ts)。
 * 计划书 4.3:Renderer 在切换条目时自动写草稿,离开页面同样会触发 saveDraft。
 */
const drafts = [
  {
    key: 'd-1',
    title: 'QA 质量评估 · 批次 Q12 - 第 18 题',
    updatedAt: '今天 14:32 自动保存',
    schemaVersion: 'v3',
  },
  {
    key: 'd-2',
    title: '偏好对比 A/B · 批次 P07 - 第 6 题',
    updatedAt: '昨天 18:01 自动保存',
    schemaVersion: 'v2',
  },
];

export default function Drafts() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>草稿箱</Typography.Title>
          <Typography.Text type="secondary">
            未提交的标注答卷会自动保存在此,可随时继续编辑或删除。
          </Typography.Text>
        </Space>
        <Button icon={<CloudSyncOutlined />}>同步最新草稿</Button>
      </div>

      <Card>
        <List
          dataSource={drafts}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button key="continue" type="link">
                  继续编辑
                </Button>,
                <Button key="delete" type="link" danger icon={<DeleteOutlined />}>
                  删除
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space>
                    {item.title}
                    <Tag color="default">Schema {item.schemaVersion}</Tag>
                  </Space>
                }
                description={item.updatedAt}
              />
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
