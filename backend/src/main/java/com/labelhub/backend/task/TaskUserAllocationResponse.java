package com.labelhub.backend.task;

public record TaskUserAllocationResponse(
    String userId,
    String username,
    String displayName,
    int itemCount) {}
