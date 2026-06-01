package com.labelhub.backend.annotation;

import java.util.List;

public record AssistantAskRequest(
    String question,
    List<AssistantMessageRequest> history) {}
