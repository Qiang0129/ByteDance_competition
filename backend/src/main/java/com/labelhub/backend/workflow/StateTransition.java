package com.labelhub.backend.workflow;

public record StateTransition(
    WorkflowEntityType entityType,
    String fromState,
    String toState,
    String action,
    String operatorRole) {}
