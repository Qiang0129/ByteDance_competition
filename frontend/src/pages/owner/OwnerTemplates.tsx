import { useEffect, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  CheckCircleFilled,
  CopyOutlined,
  EditOutlined,
  ExportOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';

import { schemaApi } from '../../api/schema';
import type { SchemaSummary } from '../../types/schema';

/**
 * 模板列表页。计划书 4.2:
 *   - 拖拽物料 / 属性面板 / Schema 版本管理(Designer 与 Renderer 共用同一份 Schema)
 *   - 接口预留:GET /schemas、GET /schemas/{versionId}、POST /tasks/{id}/schemas/draft、
 *             POST /schemas/{id}/publish
 *
 * 当前阶段后端未实现,前端兜底渲染样例数据,保证 Designer 入口、版本切换、复制/导出等
 * 交互可用。
 */

type StatusFilter = 'all' | 'draft' | 'published';

const sampleTemplates: SchemaSummary[] = [
  {
    versionId: 'sv-001',
    versionNumber: 'r12',
    name: '商品清洗 · v3',
    taskId: 'T-2041',
    taskTitle: '商品标题清洗 v3 · 抖音电商',
    status: 'published',
    fieldCount: 8,
    updatedAt: '2026-05-22 16:48',
    createdBy: '张涛',
  },
  {
    versionId: 'sv-002',
    versionNumber: 'r07',
    name: '偏好对比 A/B',
    taskId: 'T-2039',
    taskTitle: '短视频脚本对齐评测',
    status: 'published',
    fieldCount: 6,
    updatedAt: '2026-05-19 10:12',
    createdBy: '李南',
  },
  {
    versionId: 'sv-003',
    versionNumber: 'r03',
    name: '图像分类 · 交通标志',
    taskId: 'T-2055',
    taskTitle: '图像分类 · 交通标志 V4',
    status: 'published',
    fieldCount: 5,
    updatedAt: '2026-05-15 14:25',
    createdBy: '王慕白',
  },
  {
    versionId: 'sv-004',
    versionNumber: 'r02',
    name: '客服多轮对话安全',
    status: 'draft',
    fieldCount: 4,
    updatedAt: '2026-05-23 09:20',
    createdBy: '陈一',
  },
  {
    versionId: 'sv-005',
    versionNumber: 'r01',
    name: 'AIGC 图文质检',
    taskId: 'T-2063',
    taskTitle: 'AIGC 图文质量打分',
    status: 'draft',
    fieldCount: 7,
    updatedAt: '2026-05-21 21:08',
    createdBy: '赵雪',
  },
];

export default function OwnerTemplates() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [templates, setTemplates] = useState<SchemaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [keyword, setKeyword] = useState('');
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const resp = await schemaApi.listSchemas();
        if (cancelled) return;
        setTemplates(resp.items ?? []);
        setUsingFallback(false);
      } catch {
        if (cancelled) return;
        setTemplates(sampleTemplates);
        setUsingFallback(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (keyword) {
        const kw = keyword.toLowerCase();
        const hay = `${t.name} ${t.versionNumber} ${t.taskTitle ?? ''} ${t.createdBy}`
          .toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [templates, statusFilter, keyword]);

  const stats = useMemo(() => {
    return {
      total: templates.length,
      published: templates.filter((t) => t.status === 'published').length,
      draft: templates.filter((t) => t.status === 'draft').length,
    };
  }, [templates]);

  function handleOpen(template: SchemaSummary) {
    navigate(`/owner/templates/designer?versionId=${encodeURIComponent(template.versionId)}`);
  }

  function handleCreate() {
    navigate('/owner/templates/designer?new=1');
  }

  function handleDuplicate(template: SchemaSummary) {
    message.success(`已复制模板「${template.name}」为新草稿`);
    // 真实场景:调用 schemaApi.createStandaloneDraft({ ...复制后的字段 })
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Typography.Title level={3}>模板搭建</Typography.Title>
          <Typography.Text type="secondary">
            拖拽物料 / 属性面板 / Schema 版本化,Designer 与 Renderer 共用一份 Schema。
          </Typography.Text>
        </Space>
        <Space>
          {usingFallback && <Tag color="gold">演示模式 · 接口未连接</Tag>}
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新建模板
          </Button>
        </Space>
      </div>

      {/* 概览卡 */}
      <Row gutter={16}>
        <Col xs={24} sm={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">模板总数</div>
            <div className="owner-stat-value owner-stat-primary">{stats.total}</div>
            <Tag className="owner-stat-trend owner-stat-mute">含全部草稿与已发布</Tag>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">已发布</div>
            <div className="owner-stat-value">{stats.published}</div>
            <Tag color="success" className="owner-stat-trend">
              <CheckCircleFilled /> Renderer 可用
            </Tag>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="owner-stat-card">
            <div className="owner-stat-label">草稿</div>
            <div className="owner-stat-value">{stats.draft}</div>
            <Tag color="processing" className="owner-stat-trend">
              <EditOutlined /> 编辑中
            </Tag>
          </Card>
        </Col>
      </Row>

      {/* 工具条 */}
      <Card className="owner-toolbar">
        <Space size={12} wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索模板名 / 版本号 / 关联任务 / 创建人"
            style={{ width: 320 }}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Segmented
            options={[
              { label: '全部', value: 'all' },
              { label: '已发布', value: 'published' },
              { label: '草稿', value: 'draft' },
            ]}
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
          />
        </Space>
      </Card>

      {/* 模板卡片 */}
      {loading ? (
        <Card>
          <div className="market-loading">
            加载模板...
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <Empty description="还没有匹配的模板,试试新建一个或调整筛选。" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {filtered.map((template) => (
            <Col key={template.versionId} xs={24} md={12} xl={8}>
              <TemplateCard
                template={template}
                onOpen={() => handleOpen(template)}
                onDuplicate={() => handleDuplicate(template)}
              />
            </Col>
          ))}
        </Row>
      )}
    </Space>
  );
}

function TemplateCard({
  template,
  onOpen,
  onDuplicate,
}: {
  template: SchemaSummary;
  onOpen: () => void;
  onDuplicate: () => void;
}) {
  const isPublished = template.status === 'published';
  return (
    <Card className="template-card" onClick={onOpen}>
      <div className="template-card-head">
        <div className="template-card-icon">
          <AppstoreOutlined />
        </div>
        <Space direction="vertical" size={2} style={{ flex: 1, minWidth: 0 }}>
          <Space size={6} wrap>
            <span className="template-card-name">{template.name}</span>
            <Tag className="template-version-tag">{template.versionNumber}</Tag>
          </Space>
          <Typography.Text type="secondary" className="template-card-task">
            {template.taskTitle ?? '尚未绑定任务'}
          </Typography.Text>
        </Space>
        {isPublished ? (
          <Tag color="success" className="template-status-tag">
            <CheckCircleFilled /> 已发布
          </Tag>
        ) : (
          <Tag color="processing" className="template-status-tag">
            <EditOutlined /> 草稿
          </Tag>
        )}
      </div>

      <div className="template-card-meta">
        <span>{template.fieldCount} 个字段</span>
        <span>·</span>
        <span>更新 {template.updatedAt}</span>
        <span>·</span>
        <span>{template.createdBy}</span>
      </div>

      <div className="template-card-foot" onClick={(event) => event.stopPropagation()}>
        <Tooltip title="复制为新草稿">
          <Button size="small" icon={<CopyOutlined />} onClick={onDuplicate}>
            复制
          </Button>
        </Tooltip>
        <Tooltip title="导出 Schema JSON">
          <Button size="small" icon={<ExportOutlined />}>
            导出
          </Button>
        </Tooltip>
        <Button type="primary" size="small" onClick={onOpen}>
          打开 Designer
        </Button>
      </div>
    </Card>
  );
}
