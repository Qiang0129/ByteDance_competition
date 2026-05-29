package com.labelhub.backend.review;

public record ReviewDecisionRequest(
    String decision,
    String reason,
    String note,
    Boolean escalate) {}
