package com.labelhub.backend.task;

import java.util.List;

public record OwnerTaskDetailResponse(
    OwnerTaskResponse task,
    String itemSelectionMode,
    List<String> selectedItemIds,
    List<TaskUserAllocationResponse> labelerAllocations,
    List<TaskUserAllocationResponse> reviewerAllocations) {}
