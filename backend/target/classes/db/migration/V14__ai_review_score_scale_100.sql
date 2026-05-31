-- Move AI review rules from the legacy 5-point scale to a 100-point scale.

USE labelhub;

ALTER TABLE ai_review_rules
  MODIFY pass_threshold DECIMAL(10, 4) NOT NULL DEFAULT 80.0000,
  MODIFY need_human_threshold DECIMAL(10, 4) NOT NULL DEFAULT 70.0000;

UPDATE ai_review_rules r
JOIN (
  SELECT
    parsed.rule_id,
    MIN(COALESCE(parsed.max_score, 0)) AS min_dimension_score,
    MAX(COALESCE(parsed.max_score, 0)) AS max_dimension_score,
    JSON_ARRAYAGG(
      JSON_OBJECT(
        'key', parsed.dimension_key,
        'label', parsed.dimension_label,
        'weight', parsed.dimension_weight,
        'maxScore', 100
      )
    ) AS next_dimensions_json
  FROM (
    SELECT
      r2.id AS rule_id,
      jt.ord,
      jt.dimension_key,
      jt.dimension_label,
      jt.dimension_weight,
      jt.max_score
    FROM ai_review_rules r2
    JOIN JSON_TABLE(
      r2.dimensions_json,
      '$[*]' COLUMNS (
        ord FOR ORDINALITY,
        dimension_key VARCHAR(128) PATH '$.key',
        dimension_label VARCHAR(128) PATH '$.label',
        dimension_weight DECIMAL(10, 6) PATH '$.weight',
        max_score DECIMAL(10, 4) PATH '$.maxScore'
      )
    ) AS jt
    WHERE r2.deleted_at IS NULL
    ORDER BY r2.id, jt.ord
  ) parsed
  GROUP BY parsed.rule_id
) converted ON converted.rule_id = r.id
SET
  r.dimensions_json = CASE
    WHEN converted.min_dimension_score <> 100 OR converted.max_dimension_score <> 100 THEN converted.next_dimensions_json
    ELSE r.dimensions_json
  END,
  r.pass_threshold = CASE
    WHEN r.pass_threshold <= 5 THEN r.pass_threshold * 20
    ELSE r.pass_threshold
  END,
  r.need_human_threshold = CASE
    WHEN r.need_human_threshold <= 5 THEN r.need_human_threshold * 20
    ELSE r.need_human_threshold
  END,
  r.prompt_template = REPLACE(
    REPLACE(r.prompt_template, '每项 0~5', '每项 0~100'),
    '每项 0-5',
    '每项 0-100'
  ),
  r.updated_at = CURRENT_TIMESTAMP
WHERE r.deleted_at IS NULL
  AND (
    converted.min_dimension_score <> 100
    OR converted.max_dimension_score <> 100
    OR r.pass_threshold <= 5
    OR r.need_human_threshold <= 5
  );

UPDATE ai_review_rules
SET
  prompt_template = '你是 LabelHub 的 AI 预审员。请根据题目原始数据 {{rawPayload}}、标注答案 {{answer}}、表单 schema {{schema}} 和规则 {{rule}} 进行质量审核。按 0~100 分为每个维度评分，给出总分、风险标签、证据和 PASS / NEED_HUMAN_REVIEW / REJECT 判定。',
  pass_threshold = 80.0000,
  need_human_threshold = 70.0000,
  updated_at = CURRENT_TIMESTAMP
WHERE deleted_at IS NULL
  AND name = '默认质量预审规则';

UPDATE ai_review_results r
LEFT JOIN (
  SELECT
    parsed.result_id,
    JSON_OBJECTAGG(parsed.score_key, LEAST(100, parsed.score_value * 20)) AS next_scores_json
  FROM (
    SELECT
      r2.id AS result_id,
      jt.score_key,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(r2.scores_json, CONCAT('$.', jt.score_key))) AS DECIMAL(10, 4)) AS score_value
    FROM ai_review_results r2
    JOIN ai_review_jobs aj ON aj.id = r2.job_id
    JOIN JSON_TABLE(
      JSON_KEYS(r2.scores_json),
      '$[*]' COLUMNS (
        score_key VARCHAR(128) PATH '$'
      )
    ) AS jt
    WHERE r2.total_score IS NOT NULL
      AND r2.total_score <= 5
      AND r2.scores_json IS NOT NULL
      AND JSON_TYPE(r2.scores_json) = 'OBJECT'
      AND CAST(JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.dimensions[0].maxScore')) AS DECIMAL(10, 4)) <= 5
  ) parsed
  GROUP BY parsed.result_id
) converted ON converted.result_id = r.id
JOIN ai_review_jobs aj ON aj.id = r.job_id
SET
  r.scores_json = COALESCE(converted.next_scores_json, r.scores_json),
  r.total_score = r.total_score * 20
WHERE r.total_score IS NOT NULL
  AND r.total_score <= 5
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(aj.rule_snapshot_json, '$.dimensions[0].maxScore')) AS DECIMAL(10, 4)) <= 5;

UPDATE ai_review_jobs j
JOIN (
  SELECT
    parsed.job_id,
    MIN(COALESCE(parsed.max_score, 0)) AS min_dimension_score,
    MAX(COALESCE(parsed.max_score, 0)) AS max_dimension_score,
    JSON_ARRAYAGG(
      JSON_OBJECT(
        'key', parsed.dimension_key,
        'label', parsed.dimension_label,
        'weight', parsed.dimension_weight,
        'maxScore', 100
      )
    ) AS next_dimensions_json
  FROM (
    SELECT
      j2.id AS job_id,
      jt.ord,
      jt.dimension_key,
      jt.dimension_label,
      jt.dimension_weight,
      jt.max_score
    FROM ai_review_jobs j2
    JOIN JSON_TABLE(
      j2.rule_snapshot_json,
      '$.dimensions[*]' COLUMNS (
        ord FOR ORDINALITY,
        dimension_key VARCHAR(128) PATH '$.key',
        dimension_label VARCHAR(128) PATH '$.label',
        dimension_weight DECIMAL(10, 6) PATH '$.weight',
        max_score DECIMAL(10, 4) PATH '$.maxScore'
      )
    ) AS jt
    WHERE j2.rule_snapshot_json IS NOT NULL
    ORDER BY j2.id, jt.ord
  ) parsed
  GROUP BY parsed.job_id
) converted ON converted.job_id = j.id
SET j.rule_snapshot_json = JSON_SET(
  j.rule_snapshot_json,
  '$.dimensions',
  converted.next_dimensions_json,
  '$.passThreshold',
  CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.name')) = '默认质量预审规则'
      THEN 80
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold')) AS DECIMAL(10, 4)) <= 5
      THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold')) AS DECIMAL(10, 4)) * 20
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold')) AS DECIMAL(10, 4)) > 100
      OR JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold') IS NULL
      THEN 80
    ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold')) AS DECIMAL(10, 4))
  END,
  '$.needHumanThreshold',
  CASE
    WHEN JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.name')) = '默认质量预审规则'
      THEN 70
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold')) AS DECIMAL(10, 4)) <= 5
      THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold')) AS DECIMAL(10, 4)) * 20
    WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold')) AS DECIMAL(10, 4)) > 100
      OR JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold') IS NULL
      THEN 70
    ELSE CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold')) AS DECIMAL(10, 4))
  END,
  '$.promptTemplate',
  REPLACE(
    REPLACE(
      COALESCE(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.promptTemplate')), ''),
      '每项 0~5',
      '每项 0~100'
    ),
    '每项 0-5',
    '每项 0-100'
  )
)
WHERE converted.min_dimension_score <> 100
  OR converted.max_dimension_score <> 100
  OR JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.name')) = '默认质量预审规则'
  OR CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold')) AS DECIMAL(10, 4)) <= 5
  OR CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold')) AS DECIMAL(10, 4)) > 100
  OR JSON_EXTRACT(j.rule_snapshot_json, '$.passThreshold') IS NULL
  OR CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold')) AS DECIMAL(10, 4)) <= 5
  OR CAST(JSON_UNQUOTE(JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold')) AS DECIMAL(10, 4)) > 100
  OR JSON_EXTRACT(j.rule_snapshot_json, '$.needHumanThreshold') IS NULL;
