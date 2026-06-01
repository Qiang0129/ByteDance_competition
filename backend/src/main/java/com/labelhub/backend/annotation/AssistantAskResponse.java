package com.labelhub.backend.annotation;

public record AssistantAskResponse(
    String answer,
    Integer tokensUsed,
    String createdAt) {}
