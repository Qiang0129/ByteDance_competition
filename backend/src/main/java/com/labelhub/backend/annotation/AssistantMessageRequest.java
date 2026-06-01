package com.labelhub.backend.annotation;

public record AssistantMessageRequest(
    String role,
    String content) {}
