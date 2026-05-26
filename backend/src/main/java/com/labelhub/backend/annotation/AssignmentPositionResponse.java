package com.labelhub.backend.annotation;

public record AssignmentPositionResponse(
    int index,
    int total,
    String prevAssignmentId,
    String nextAssignmentId) {}
