package com.labelhub.backend.ownerreview;

import java.util.List;

public record OwnerReviewAuditItemTimelineResponse(
    String assignmentId,
    String taskId,
    String taskTitle,
    String annotationId,
    String itemId,
    Integer itemIndex,
    String labelerName,
    String itemTitle,
    List<OwnerReviewAuditLogEntryResponse> items) {}
