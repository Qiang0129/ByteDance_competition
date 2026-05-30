import { CloudSyncOutlined, DeleteOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  List,
  Popconfirm,
  Skeleton,
  Space,
  Tag,
  Typography,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiErrorMessage } from '../../api/client';
import { labelerApi } from '../../api/labeler';
import type { LabelerDraft } from '../../types/labeler';

const PAGE_SIZE = 50;

export default function Drafts() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [drafts, setDrafts] = useState<LabelerDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await labelerApi.listDrafts({ page: 1, pageSize: PAGE_SIZE });
      setDrafts(response.items);
    } catch (requestError) {
      setDrafts([]);
      setError(getApiErrorMessage(requestError, '草稿箱接口暂不可用'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const handleDelete = async (assignmentId: string) => {
    setDeletingId(assignmentId);
    try {
      await labelerApi.deleteDraft(assignmentId);
      setDrafts((current) => current.filter((draft) => draft.assignmentId !== assignmentId));
      message.success('草稿已删除');
    } catch (requestError) {
      message.error(getApiErrorMessage(requestError, '删除草稿失败'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>草稿箱</Typography.Title>
          <Typography.Text type="secondary">
            未提交的标注答卷会自动保存在此,可随时继续编辑或删除。
          </Typography.Text>
        </Space>
        <Button
          icon={<CloudSyncOutlined />}
          loading={loading}
          onClick={() => void loadDrafts()}
        >
          同步最新草稿
        </Button>
      </div>

      {error ? (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => void loadDrafts()}>
              重试
            </Button>
          }
        />
      ) : null}

      <Card>
        {loading ? (
          <Skeleton active paragraph={{ rows: 5 }} />
        ) : (
          <List
            dataSource={drafts}
            locale={{
              emptyText: <Empty description="暂无草稿,进入任务作答后会自动保存。" />,
            }}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Button
                    key="continue"
                    type="link"
                    disabled={!item.editable}
                    onClick={() => navigate(`/labeler/answer/${item.assignmentId}`)}
                  >
                    继续编辑
                  </Button>,
                  <Popconfirm
                    key="delete"
                    title="删除草稿"
                    description="只删除当前草稿,不会删除已领取任务。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleDelete(item.assignmentId)}
                  >
                    <Button
                      type="link"
                      danger
                      icon={<DeleteOutlined />}
                      loading={deletingId === item.assignmentId}
                    >
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={[8, 4]} wrap>
                      <Typography.Text strong>{item.title}</Typography.Text>
                      <Tag color="blue">{item.taskType}</Tag>
                      {item.schemaVersion ? (
                        <Tag color="default">Schema {item.schemaVersion}</Tag>
                      ) : null}
                    </Space>
                  }
                  description={
                    <Space size={[8, 4]} wrap>
                      <span>{item.updatedAt ? `${item.updatedAt} 自动保存` : '最近自动保存时间未知'}</span>
                      <span>题目 {item.itemId}</span>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </Space>
  );
}
