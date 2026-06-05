package com.labelhub.backend.annotation;

public record LabelerItemHistoryResponse(
    String id,
    String type,
    String title,
    String actor,
    String decision,
    String reason,
    String comment,
    Double score,
    String occurredAt,
    String status) {}
