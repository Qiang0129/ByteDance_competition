package com.labelhub.backend.ownerreview;

public record OwnerReviewAnnotationResponse(
    String annotationId,
    String itemId,
    int itemIndex,
    String labelerName,
    String submittedAt,
    String status,
    String aiDecision,
    String lastDecision,
    String lastReviewer,
    String updatedAt,
    boolean sampling) {}
