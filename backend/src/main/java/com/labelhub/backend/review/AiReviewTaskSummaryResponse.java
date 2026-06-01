package com.labelhub.backend.review;

/**
 * Reviewer 端 AI 预审任务摘要响应。
 *
 * 字段语义随 view 参数变化:
 *   - view=pending(默认):pendingHuman = 待我审条数;reviewedCount = 0。
 *   - view=reviewed:pendingHuman = 0;reviewedCount = 我已审条数。
 *   - view=all:pendingHuman = 待审条数;reviewedCount = 已审条数。
 */
public record AiReviewTaskSummaryResponse(
    String taskId,
    String taskTitle,
    String taskType,
    long total,
    long passCount,
    long needHumanCount,
    long rejectCount,
    long pendingHuman,
    long reviewedCount,
    String updatedAt) {}
