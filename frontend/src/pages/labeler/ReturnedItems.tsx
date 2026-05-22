import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card, List, Space, Tag, Typography } from 'antd';

/**
 * 打回项。
 * 接口预留:GET /assignments/mine?status=RETURNED(见 api/labeler.ts)。
 * 计划书 4.5:审核员驳回必须附带 reason,Labeler 可在此查看上一轮的审核意见并重新提交。
 */
const returnedItems = [
  {
    key: 'r-1',
    title: 'QA 质量评估 · 批次 Q12 - 第 14 题',
    reviewer: '审核员 R1',
    reason: '风险维度未覆盖事实性错误,请补充 evidence 字段并重新提交。',
    revisionNo: 1,
    updatedAt: '今天 11:08',
  },
  {
    key: 'r-2',
    title: '偏好对比 A/B · 批次 P07 - 第 3 题',
    reviewer: '审核员 R2',
    reason: '强度判断与 rationale 不一致,请重新审视并明确说明依据。',
    revisionNo: 2,
    updatedAt: '昨天 15:22',
  },
];

export default function ReturnedItems() {
  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>打回项</Typography.Title>
          <Typography.Text type="secondary">
            审核员驳回的答卷会显示完整原因,修改后可再次提交。
          </Typography.Text>
        </Space>
      </div>

      <Alert
        type="warning"
        showIcon
        icon={<ExclamationCircleOutlined />}
        message="处理打回项时请保持已提交的字段完整,避免出现 schemaVersion 与字段名不一致的情况。"
      />

      <Card>
        <List
          dataSource={returnedItems}
          renderItem={(item) => (
            <List.Item
              actions={[
                <Button key="modify" type="link">
                  修改并重提
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Space size={8}>
                    {item.title}
                    <Tag color="red">第 {item.revisionNo} 次返修</Tag>
                  </Space>
                }
                description={
                  <Space direction="vertical" size={2}>
                    <span>{item.reviewer} · {item.updatedAt}</span>
                    <Typography.Text type="secondary">驳回原因:{item.reason}</Typography.Text>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Card>
    </Space>
  );
}
