package com.labelhub.backend.review;

public record ReviewTimelineStageResponse(
    int roundNo,
    String stage,
    String title,
    String status,
    String actor,
    String decision,
    Double score,
    String comment,
    String reason,
    String occurredAt) {}
