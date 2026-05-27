import {
  ArrowRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  FileTextOutlined,
  RightOutlined,
  RiseOutlined,
  RobotOutlined,
  ShopOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { Avatar, Button, Card, Col, Progress, Row, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';

import { useThemeColors } from '../../theme/useThemeColors';

/**
 * Labeler 工作概览。
 * 信息架构对齐《项目实施计划书》4.3 与《LabelHub Project Implementation Plan EN》4.3:
 *   任务市场 → 答题(Renderer) → 草稿自动保存 → 提交触发 AI 预审(4.4)→ 人工审核(4.5)→ 通过 / 打回修改
 * 数据接入 api/labeler.ts 之前先以 mock 渲染骨架,字段命名与计划书保持一致。
 */

interface KpiItem {
  key: string;
  title: string;
  value: number | string;
  suffix?: string;
  trend?: string;
  trendUp?: boolean;
  icon: React.ReactNode;
  /** 装饰圆点的颜色,与图标背景呼应,不直接参与功能 */
  accent: string;
}

const kpiList: KpiItem[] = [
  {
    key: 'in-progress',
    title: '进行中任务',
    value: 5,
    icon: <FileTextOutlined />,
    accent: '#2f7bff',
    trend: '+2 较昨日',
    trendUp: true,
  },
  {
    key: 'submitted-today',
    title: '今日已提交',
    value: 26,
    icon: <RiseOutlined />,
    accent: '#22c55e',
    trend: '完成率 87%',
    trendUp: true,
  },
  {
    key: 'returned',
    title: '待修改打回',
    value: 2,
    icon: <ExclamationCircleFilled />,
    accent: '#f59e0b',
    trend: '需 24h 内重提',
    trendUp: false,
  },
  {
    key: 'avg-time',
    title: '平均耗时',
    value: 18,
    suffix: '秒/条',
    icon: <ThunderboltFilled />,
    accent: '#a855f7',
    trend: '-3s 较本周',
    trendUp: true,
  },
];

/** AI 预审 + 人工审核结果分布,对应计划书 4.4 PASS / REJECT / NEED_HUMAN_REVIEW 与 4.5 审核流转 */
const reviewDistribution = [
  { key: 'ai-pass', label: 'AI 通过', value: 64, color: '#2f7bff' },
  { key: 'ai-need-human', label: '需人工复核', value: 18, color: '#a855f7' },
  { key: 'ai-reject', label: 'AI 拒绝', value: 6, color: '#ef4444' },
  { key: 'human-pass', label: '人工通过', value: 9, color: '#22c55e' },
  { key: 'returned', label: '打回修改', value: 3, color: '#f59e0b' },
];

const recentBatches = [
  {
    key: 'q12',
    title: 'QA 质量评估 · 批次 Q12',
    description: '问答正确性 / 完整性 / 风险三维度评估',
    tag: 'QA Quality',
    quotaLeft: 24,
    quotaTotal: 50,
    deadline: '06-05 24:00',
    rewardPerItem: 0.6,
  },
  {
    key: 'p07',
    title: '偏好对比 A/B · 批次 P07',
    description: '同一 Prompt 下两条模型回答的偏好选择与强度',
    tag: 'Preference Compare',
    quotaLeft: 18,
    quotaTotal: 30,
    deadline: '06-08 24:00',
    rewardPerItem: 0.8,
  },
];

/** 计划书 1.4 强调的多模态字段:item 渲染保留 text/image/video/markdown 全部类型 */
const supportedItemTypes = [
  { key: 'text', label: 'Text', tone: '#2f7bff' },
  { key: 'image', label: 'Image', tone: '#22c55e' },
  { key: 'video', label: 'Video', tone: '#a855f7' },
  { key: 'markdown', label: 'Markdown', tone: '#f59e0b' },
];

const reviewTotal = reviewDistribution.reduce((sum, item) => sum + item.value, 0);

export default function LabelerOverview() {
  const navigate = useNavigate();
  const themeColors = useThemeColors();

  return (
    <Space direction="vertical" size="large" className="page-stack labeler-overview">
      {/* ============ 欢迎横幅:主 CTA + 总贡献度 ============ */}
      <section className="overview-hero">
        <div className="overview-hero-content">
          <Tag className="overview-hero-tag">Phase 1 · MVP</Tag>
          <Typography.Title level={2} className="overview-hero-title">
            欢迎回来,继续你的标注工作
          </Typography.Title>
          <Typography.Paragraph className="overview-hero-desc">
            浏览任务市场认领新的批次,在线作答会自动保存草稿;提交后将进入 AI 预审与人工审核闭环,
            打回项可在「打回项」页查看原因后重新提交。
          </Typography.Paragraph>
          <div className="overview-hero-actions">
            {/* 不用 type="primary" 避免在渐变模式下被通用主按钮渐变规则盖住,
               用 .overview-hero-cta 类自定义白底主色字 */}
            <div className="overview-hero-btn-wrap">
              <Button
                size="large"
                icon={<ShopOutlined />}
                onClick={() => navigate('/labeler/market')}
                className="overview-hero-cta"
              >
                进入任务市场
              </Button>
            </div>
            <div className="overview-hero-btn-wrap">
              <Button
                size="large"
                icon={<EditOutlined />}
                onClick={() => navigate('/labeler/drafts')}
                className="overview-hero-secondary"
              >
                查看草稿
              </Button>
            </div>
          </div>
        </div>

        <div className="overview-hero-stats">
          <div className="overview-hero-stat">
            <span className="overview-hero-stat-value">312</span>
            <span className="overview-hero-stat-label">本周累计提交</span>
          </div>
          <div className="overview-hero-divider" />
          <div className="overview-hero-stat">
            <span className="overview-hero-stat-value">94.2%</span>
            <span className="overview-hero-stat-label">审核通过率</span>
          </div>
          <div className="overview-hero-divider" />
          <div className="overview-hero-stat">
            <span className="overview-hero-stat-value">¥186</span>
            <span className="overview-hero-stat-label">本月奖励预估</span>
          </div>
        </div>
      </section>

      {/* ============ 4 张 KPI ============ */}
      <Row gutter={[16, 16]}>
        {kpiList.map((kpi) => (
          <Col xs={24} sm={12} xl={6} key={kpi.key}>
            <Card className="kpi-card">
              <div className="kpi-head">
                <span className="kpi-icon" style={{ background: `${kpi.accent}15`, color: kpi.accent }}>
                  {kpi.icon}
                </span>
                <span className="kpi-title">{kpi.title}</span>
              </div>
              <div className="kpi-value">
                {kpi.value}
                {kpi.suffix && <span className="kpi-suffix">{kpi.suffix}</span>}
              </div>
              {kpi.trend && (
                <div className={`kpi-trend ${kpi.trendUp ? 'is-up' : 'is-down'}`}>{kpi.trend}</div>
              )}
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        {/* ============ 本日目标 + 进度 ============ */}
        <Col xs={24} xl={16}>
          <Card
            className="overview-progress-card"
            title="今日标注节奏"
            extra={
              <Typography.Text type="secondary">目标 30 条 · 当前 26 条</Typography.Text>
            }
          >
            <Progress percent={87} strokeColor={themeColors.progress} />

            <Row gutter={16} className="overview-progress-meta">
              <Col span={8}>
                <div className="overview-meta-label">提交总数</div>
                <div className="overview-meta-value">26</div>
              </Col>
              <Col span={8}>
                <div className="overview-meta-label">AI 预审通过</div>
                <div className="overview-meta-value">22</div>
              </Col>
              <Col span={8}>
                <div className="overview-meta-label">人工已确认</div>
                <div className="overview-meta-value">19</div>
              </Col>
            </Row>

            <Typography.Paragraph type="secondary" className="overview-progress-tip">
              <ClockCircleOutlined /> 平均耗时 18 秒/条,按当前速度可在 19:30 前完成今日目标。
            </Typography.Paragraph>
          </Card>
        </Col>

        {/* ============ AI 审核分布 ============ */}
        <Col xs={24} xl={8}>
          <Card
            className="overview-review-card"
            title={
              <Space size={8}>
                <RobotOutlined style={{ color: 'var(--lh-primary)' }} />
                AI 审核分布
              </Space>
            }
            extra={<Typography.Text type="secondary">最近 7 日</Typography.Text>}
          >
            <div className="review-bar">
              {reviewDistribution.map((item) => (
                <span
                  key={item.key}
                  className="review-bar-seg"
                  style={{
                    width: `${(item.value / reviewTotal) * 100}%`,
                    background: item.color,
                  }}
                />
              ))}
            </div>
            <ul className="review-legend">
              {reviewDistribution.map((item) => (
                <li key={item.key}>
                  <span className="review-legend-dot" style={{ background: item.color }} />
                  <span className="review-legend-label">{item.label}</span>
                  <span className="review-legend-value">{item.value}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* ============ 最近任务 ============ */}
        <Col xs={24} xl={16}>
          <Card
            className="overview-batch-card"
            title="最近的任务批次"
            extra={
              <Button type="link" onClick={() => navigate('/labeler/my-tasks')} className="overview-link">
                查看全部 <RightOutlined />
              </Button>
            }
          >
            <div className="batch-list">
              {recentBatches.map((batch) => {
                const ratio = (batch.quotaLeft / batch.quotaTotal) * 100;
                return (
                  <div key={batch.key} className="batch-item">
                    <div className="batch-item-head">
                      <Space size={8} wrap>
                        <span className="batch-item-title">{batch.title}</span>
                        <Tag color="blue" className="batch-item-tag">
                          {batch.tag}
                        </Tag>
                      </Space>
                      <Tag className="batch-item-reward">¥{batch.rewardPerItem.toFixed(2)} / 条</Tag>
                    </div>
                    <div className="batch-item-desc">{batch.description}</div>
                    <div className="batch-item-foot">
                      <div className="batch-item-progress">
                        <Progress
                          percent={Math.round(100 - ratio)}
                          showInfo={false}
                          size="small"
                          strokeColor={themeColors.primary}
                        />
                        <span className="batch-item-quota">
                          剩余 <strong>{batch.quotaLeft}</strong> / {batch.quotaTotal}
                        </span>
                      </div>
                      <Space size={12}>
                        <span className="batch-item-deadline">
                          <ClockCircleOutlined /> 截止 {batch.deadline}
                        </span>
                        <Button type="primary" size="small">
                          进入答题 <ArrowRightOutlined />
                        </Button>
                      </Space>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Col>

        {/* ============ 快捷入口 + 支持类型 ============ */}
        <Col xs={24} xl={8}>
          <Space direction="vertical" size={16} className="page-stack">
            <Card className="overview-shortcut-card" title="快捷入口">
              <div className="shortcut-grid">
                <button
                  type="button"
                  className="shortcut-tile"
                  onClick={() => navigate('/labeler/market')}
                >
                  <ShopOutlined />
                  <span>任务市场</span>
                </button>
                <button
                  type="button"
                  className="shortcut-tile"
                  onClick={() => navigate('/labeler/my-tasks')}
                >
                  <FileTextOutlined />
                  <span>我的任务</span>
                </button>
                <button
                  type="button"
                  className="shortcut-tile"
                  onClick={() => navigate('/labeler/drafts')}
                >
                  <EditOutlined />
                  <span>草稿箱</span>
                </button>
                <button
                  type="button"
                  className="shortcut-tile"
                  onClick={() => navigate('/labeler/returned')}
                >
                  <ExclamationCircleFilled />
                  <span>打回项</span>
                </button>
              </div>
            </Card>

            <Card className="overview-types-card" title="支持的题目类型">
              <Typography.Paragraph type="secondary" className="types-desc">
                Renderer 已对齐计划书 1.4 多模态保留:
                <code>raw_payload / media_type / media_url / content_markdown</code> 全部透传。
              </Typography.Paragraph>
              <div className="types-list">
                {supportedItemTypes.map((type) => (
                  <span
                    key={type.key}
                    className="types-pill"
                    style={{ color: type.tone, background: `${type.tone}15` }}
                  >
                    <CheckCircleFilled /> {type.label}
                  </span>
                ))}
              </div>
              <div className="types-hint">
                <Avatar
                  size={28}
                  icon={<RobotOutlined />}
                  style={{ background: 'var(--lh-primary-bg-12)', color: 'var(--lh-primary)' }}
                />
                <span>提交后由 AI Agent 入队评分,失败可重试,最终由审核员裁决。</span>
              </div>
            </Card>
          </Space>
        </Col>
      </Row>
    </Space>
  );
}
