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
    Long schemaVersionId,
    Integer schemaVersion,
    Boolean aiReviewEnabled,
    Long aiReviewRuleId,
    String aiReviewRuleName,
    Boolean llmAssistEnabled,
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

  public boolean resolvedLlmAssistEnabled() {
    return llmAssistEnabled != null && llmAssistEnabled;
  }

  public Integer resolvedMaxClaimPerUser() {
    return maxClaimPerUser;
  }

  public List<Long> resolvedAssignedLabelerIds() {
    return assignedLabelerIds == null ? List.of() : assignedLabelerIds;
  }
}
