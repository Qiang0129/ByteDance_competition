package com.labelhub.backend.review;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

public record AnnotationToReviewResponse(
    String annotationId,
    String assignmentId,
    String itemId,
    String schemaVersionId,
    String labelerName,
    String submittedAt,
    String taskId,
    String taskTitle,
    String taskType,
    int itemIndex,
    JsonNode answerJson,
    JsonNode previousAnswerJson,
    JsonNode rawPayload,
    JsonNode schemaTabs,
    JsonNode schemaFields,
    AiReviewResultResponse aiResult,
    String decision,
    int revisionNo,
    boolean isDispute,
    List<ReviewTimelineStageResponse> reviewTimeline,
    /** 已完成视图下回填:最后一轮人工裁决理由 */
    String humanReason,
    /** 已完成视图下回填:最后一轮人工裁决时间(yyyy-MM-dd HH:mm:ss) */
    String humanReviewedAt,
    /** 已完成视图下回填:最后一轮人工裁决审核员姓名 */
    String humanReviewerName) {}
