import { useEffect, useMemo, useState } from 'react';
import {
  CheckOutlined,
  CloseOutlined,
  ExclamationCircleOutlined,
  RobotOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Input,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';

import { reviewerApi } from '../../api/reviewer';
import type { AiReviewResult, AnnotationToReview } from '../../types/reviewer';

/**
 * AI 审核页:聚合所有 AI 已出具结论的标注,Reviewer 可批量确认。
 * 计划书 4.4:AIReviewResult.decision 是 PASS / REJECT / NEED_HUMAN_REVIEW。
 * 4.5:Reviewer 在此可对 AI 结论一键确认或推翻,审计日志写入。
 */

const decisionMeta: Record<
  AiReviewResult['decision'],
  { color: string; label: string }
> = {
  PASS: { color: 'success', label: 'PASS' },
  REJECT: { color: 'error', label: 'REJECT' },
  NEED_HUMAN_REVIEW: { color: 'warning', label: 'NEED_HUMAN' },
};

export default function ReviewerAi() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState<AnnotationToReview[]>([]);
  const [filter, setFilter] = useState<'all' | AiReviewResult['decision']>('all');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // 后端真实场景:GET /reviewer/ai-results,这里复用 annotations endpoint
        const resp = await reviewerApi.listAnnotations('all', { pageSize: 100 });
        if (cancelled) return;
        setItems(resp.items ?? []);
        setUsingFallback(false);
      } catch {
        try {
          const res = await fetch('/sample-datasets/reviewer-annotations.json');
          const data = await res.json();
          if (cancelled) return;
          setItems((data.items as AnnotationToReview[]) ?? []);
          setUsingFallback(true);
        } catch {
          if (!cancelled) message.error('加载 AI 审核结果失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (!it.aiResult) return false;
      if (filter !== 'all' && it.aiResult.decision !== filter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        if (
          !`${it.annotationId} ${it.itemId} ${it.labelerName}`
            .toLowerCase()
            .includes(kw)
        )
          return false;
      }
      return true;
    });
  }, [items, filter, keyword]);

  async function commit(annotationId: string, decision: 'APPROVE' | 'RETURN') {
    try {
      await reviewerApi.submitReview(annotationId, { decision });
    } catch {
      // 后端未起,演示模式继续
    }
    setItems((prev) => prev.filter((it) => it.annotationId !== annotationId));
    message.success(decision === 'APPROVE' ? '已确认通过' : '已打回');
  }

  const columns: ColumnsType<AnnotationToReview> = [
    {
      title: 'Annotation',
      dataIndex: 'annotationId',
      width: 120,
      render: (id: string) => <code className="dataset-id">{id}</code>,
    },
    {
      title: 'Item / Schema',
      key: 'item',
      width: 160,
      render: (_v, record) => (
        <Space direction="vertical" size={2}>
          <span>{record.itemId}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Schema {record.schemaVersionId}
          </Typography.Text>
        </Space>
      ),
    },
    { title: 'Labeler', dataIndex: 'labelerName', width: 140 },
    {
      title: 'AI 决策',
      key: 'decision',
      width: 130,
      render: (_v, record) => {
        const ai = record.aiResult;
        if (!ai) return <Tag>无</Tag>;
        const meta = decisionMeta[ai.decision];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '总分',
      key: 'score',
      width: 90,
      render: (_v, record) => (record.aiResult ? record.aiResult.total_score : '-'),
      sorter: (a, b) => (a.aiResult?.total_score ?? 0) - (b.aiResult?.total_score ?? 0),
    },
    {
      title: 'AI 评语',
      key: 'comment',
      ellipsis: true,
      render: (_v, record) => record.aiResult?.comment ?? '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      render: (_v, record) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<CheckOutlined />}
            onClick={() => void commit(record.annotationId, 'APPROVE')}
          >
            确认通过
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<CloseOutlined />}
            onClick={() => void commit(record.annotationId, 'RETURN')}
          >
            打回
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>AI 审核</Typography.Title>
          <Typography.Text type="secondary">
            集中查看 AI 预审结果,对 NEED_HUMAN_REVIEW 项一键裁决,对 AI 误判可推翻。
          </Typography.Text>
        </Space>
        {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
      </div>

      <Card>
        <Space size={12} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索 annotation / item / 标注员"
            style={{ width: 280 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Segmented
            options={[
              { label: '全部', value: 'all' },
              { label: 'PASS', value: 'PASS' },
              { label: 'NEED_HUMAN', value: 'NEED_HUMAN_REVIEW' },
              { label: 'REJECT', value: 'REJECT' },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
          />
          <Tag icon={<RobotOutlined />} color="processing">
            共 {filtered.length} 条 AI 结果
          </Tag>
        </Space>
      </Card>

      <Card>
        <Table<AnnotationToReview>
          rowKey="annotationId"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, showTotal: (total: number) => `共 ${total} 条匹配记录`, pageSizeOptions: [10, 20, 50, 100, 200] }}
        />
      </Card>

      <Card>
        <Space direction="vertical" size={6}>
          <Space size={6} wrap>
            <ExclamationCircleOutlined style={{ color: '#f59e0b' }} />
            <Typography.Text type="secondary">
              当 AI 结果与人工裁决出现分歧并升级时,会进入「争议样本」页;计划书 4.4 要求保留 prompt 与 response 快照。
            </Typography.Text>
          </Space>
        </Space>
      </Card>
    </Space>
  );
}
