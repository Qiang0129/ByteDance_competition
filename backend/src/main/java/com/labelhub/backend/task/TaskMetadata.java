package com.labelhub.backend.task;

import java.util.List;

public record TaskMetadata(
    List<String> tags,
    String reward,
    String strategy,
    Long datasetId,
    Integer maxClaimPerUser,
    List<Long> assignedLabelerIds,
    String schema,
    Boolean aiReviewEnabled,
    String taskType,
    Double rewardPerItem) {

  public String resolvedStrategy() {
    return strategy == null || strategy.isBlank() ? "first-come" : strategy;
  }

  public String resolvedTaskType() {
    return taskType == null || taskType.isBlank() ? "Annotation Task" : taskType;
  }

  public boolean resolvedAiReviewEnabled() {
    return aiReviewEnabled == null || aiReviewEnabled;
  }

  public Integer resolvedMaxClaimPerUser() {
    return maxClaimPerUser;
  }

  public List<Long> resolvedAssignedLabelerIds() {
    return assignedLabelerIds == null ? List.of() : assignedLabelerIds;
  }
}
