package com.labelhub.backend.workflow;

public enum WorkflowEntityType {
  TASK("task"),
  ASSIGNMENT("assignment"),
  ANNOTATION("annotation"),
  AI_REVIEW_JOB("ai_review_job"),
  EXPORT_JOB("export_job");

  private final String value;

  WorkflowEntityType(String value) {
    this.value = value;
  }

  public String value() {
    return value;
  }
}
