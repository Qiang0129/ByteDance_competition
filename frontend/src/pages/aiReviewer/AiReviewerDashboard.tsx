import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  DashboardOutlined,
  ExclamationCircleFilled,
  ReloadOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import {
  App as AntdApp,
  Button,
  Card,
  Col,
  Row,
  Space,
  Statistic,
  Tag,
  Typography,
} from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';

import { aiReviewApi } from '../../api/aiReview';
import { JobsPanel, RulesPanel } from '../owner/OwnerAiReview';
import type { AiReviewJob, AiReviewRule } from '../../types/aiReview';

const { Paragraph, Text, Title } = Typography;

export default function AiReviewerDashboard() {
  const location = useLocation();

  if (location.pathname.endsWith('/jobs')) {
    return <AiReviewerShell title="Job 队列" description="查看 Agent 领取、执行、失败重试和完成状态。"><JobsPanel /></AiReviewerShell>;
  }
  if (location.pathname.endsWith('/rules')) {
    return <AiReviewerShell title="规则管理" description="维护 AI 预审 Prompt、评分维度、阈值和重试策略。"><RulesPanel /></AiReviewerShell>;
  }
  return <AiReviewerOverview />;
}

function AiReviewerShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Space direction="vertical" size="large" className="page-stack ai-review-page">
      <div className="page-title-row">
        <Space direction="vertical" size={4}>
          <Title level={3}>{title}</Title>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            {description}
          </Paragraph>
        </Space>
        <Tag color="processing" icon={<RobotOutlined />}>
          AI Reviewer
        </Tag>
      </div>
      {children}
    </Space>
  );
}

function AiReviewerOverview() {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<AiReviewJob[]>([]);
  const [rules, setRules] = useState<AiReviewRule[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [jobPage, rulePage] = await Promise.all([
        aiReviewApi.listJobs({ page: 1, pageSize: 100 }),
        aiReviewApi.listRules({ page: 1, pageSize: 50 }),
      ]);
      setJobs(jobPage.items);
      setRules(rulePage.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'AI 审核概览加载失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const pending = jobs.filter((job) => job.status === 'pending').length;
    const running = jobs.filter((job) => job.status === 'running').length;
    const succeeded = jobs.filter((job) => job.status === 'success').length;
    const failed = jobs.filter((job) => job.status === 'failed').length;
    const enabledRules = rules.filter((rule) => rule.status === 'enabled').length;
    const needHuman = jobs.filter((job) => job.decision === 'NEED_HUMAN_REVIEW').length;
    return { pending, running, succeeded, failed, enabledRules, needHuman };
  }, [jobs, rules]);

  const latestJobs = jobs.slice(0, 6);

  return (
    <AiReviewerShell
      title="AI 审核后台"
      description="跟踪 AI Agent 作业运行、失败兜底、规则启停和人工复核入口。"
    >
      <Row gutter={16} className="row-equal">
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <Statistic title="排队中" value={stats.pending} prefix={<DashboardOutlined />} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <Statistic title="执行中" value={stats.running} prefix={<RobotOutlined />} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <Statistic title="成功" value={stats.succeeded} prefix={<CheckCircleFilled />} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <Statistic title="失败" value={stats.failed} prefix={<CloseCircleFilled />} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <Statistic title="需人工" value={stats.needHuman} prefix={<ExclamationCircleFilled />} />
          </Card>
        </Col>
        <Col xs={12} md={4}>
          <Card className="owner-stat-card" loading={loading}>
            <Statistic title="启用规则" value={stats.enabledRules} />
          </Card>
        </Col>
      </Row>

      <Card className="owner-toolbar">
        <Space wrap>
          <Button type="primary" icon={<RobotOutlined />} onClick={() => navigate('/ai-reviewer/jobs')}>
            查看 Job 队列
          </Button>
          <Button onClick={() => navigate('/ai-reviewer/rules')}>管理规则</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            刷新
          </Button>
        </Space>
      </Card>

      <Card title="最近 AI 作业" className="owner-table-card" loading={loading}>
        {latestJobs.length === 0 ? (
          <Text type="secondary">暂无 AI 审核作业。Labeler 最后一题统一提交后会创建 pending job。</Text>
        ) : (
          <div className="ai-reviewer-job-list">
            {latestJobs.map((job) => (
              <div key={job.jobId} className={`ai-reviewer-job-card is-${job.status}`}>
                <div className="ai-reviewer-job-card-header">
                  <Text strong className="ai-reviewer-job-title">
                    {job.taskTitle || `任务 ${job.taskId}`}
                  </Text>
                  <Space size={6} className="ai-reviewer-job-tags">
                    <Tag color={statusColor(job.status)}>{statusLabel(job.status)}</Tag>
                    {job.decision ? <Tag>{job.decision}</Tag> : null}
                  </Space>
                </div>
                <Text type="secondary" className="ai-reviewer-job-meta">
                  Job {job.jobId} · Annotation {job.annotationId} · {job.createdAt}
                </Text>
                {job.errorSummary ? (
                  <div className="ai-reviewer-job-error" title={job.errorSummary}>
                    {job.errorSummary}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </AiReviewerShell>
  );
}

function statusColor(status: AiReviewJob['status']) {
  if (status === 'success') return 'success';
  if (status === 'running') return 'processing';
  if (status === 'failed') return 'error';
  return 'default';
}

function statusLabel(status: AiReviewJob['status']) {
  if (status === 'success') return '成功';
  if (status === 'running') return '执行中';
  if (status === 'failed') return '失败';
  return '排队中';
}
