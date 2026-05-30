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
    JsonNode answerJson,
    JsonNode previousAnswerJson,
    JsonNode rawPayload,
    AiReviewResultResponse aiResult,
    String decision,
    int revisionNo,
    boolean isDispute,
    List<ReviewTimelineStageResponse> reviewTimeline) {}
