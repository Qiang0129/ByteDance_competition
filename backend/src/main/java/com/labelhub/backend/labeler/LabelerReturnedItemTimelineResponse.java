package com.labelhub.backend.labeler;

public record LabelerReturnedItemTimelineResponse(
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
