package com.labelhub.backend.review;

public record DisputeDetailResponse(
    DisputeItemResponse dispute,
    AnnotationToReviewResponse annotation) {}
