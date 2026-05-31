package com.labelhub.backend.ai;

public record AiReviewJobTimelineItem(
    int roundNo,
    String stage,
    String title,
    String status,
    String decision,
    Double score,
    String message,
    String occurredAt) {}
