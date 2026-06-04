import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppstoreOutlined,
  CheckCircleFilled,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ExportOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router-dom';

import { getApiErrorMessage } from '../../api/client';
import { schemaApi } from '../../api/schema';
import type { SchemaSummary } from '../../types/schema';

/**
 * 模板列表页。计划书 4.2:
 *   - 拖拽物料 / 属性面板 / Schema 版本管理(Designer 与 Renderer 共用同一份 Schema)
 *   - 接口预留:GET /schemas、GET /schemas/{versionId}、POST /tasks/{id}/schemas/draft、
 *             POST /schemas/{id}/publish
 *
 * 模板数据来自后端 /api/schemas,Designer 与 Labeler Renderer 共用同一份 Schema。
 */

type StatusFilter = 'all' | 'draft' | 'published';

export default function OwnerTemplates() {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [templates, setTemplates] = useState<SchemaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [keyword, setKeyword] = useState('');

  const loadSchemas = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await schemaApi.listSchemas();
      setTemplates(resp.items ?? []);
    } catch {
      setTemplates([]);
      message.error('模板列表加载失败,请确认后端已启动并已执行 V4 数据库迁移。');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void loadSchemas();
  }, [loadSchemas]);

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

  async function handleDuplicate(template: SchemaSummary) {
    try {
      const source = await schemaApi.getSchema(template.versionId);
      await schemaApi.createStandaloneDraft({
        name: `${source.name} 副本`,
        description: source.description,
        datasetId: source.datasetId,
        datasetName: source.datasetName,
        fields: source.fields,
      });
      message.success(`已复制模板「${template.name}」为新草稿`);
      await loadSchemas();
    } catch {
      message.error('复制模板失败,请确认当前模板存在且后端接口可用。');
    }
  }

  function handleDelete(template: SchemaSummary) {
    Modal.confirm({
      title: '确认删除该草稿模板?',
      content: `模板「${template.name}」删除后将从模板列表隐藏,新任务不能再选择它;已绑定任务和历史标注不受影响。`,
      okText: '确认删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await schemaApi.deleteSchema(template.versionId);
          message.success('草稿模板已删除');
          await loadSchemas();
        } catch (error) {
          message.error(getApiErrorMessage(error, '模板删除失败'));
        }
      },
    });
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
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadSchemas()}>
            刷新
          </Button>
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
                onDuplicate={() => void handleDuplicate(template)}
                onDelete={() => handleDelete(template)}
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
  onDelete,
}: {
  template: SchemaSummary;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
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
        {!isPublished && (
          <Tooltip title="删除草稿模板">
            <Button size="small" danger icon={<DeleteOutlined />} onClick={onDelete}>
              删除
            </Button>
          </Tooltip>
        )}
        <Button type="primary" size="small" onClick={onOpen}>
          打开 Designer
        </Button>
      </div>
    </Card>
  );
}
