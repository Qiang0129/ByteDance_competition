package com.labelhub.backend.ai;

public record AiModelModelsRequest(
    String apiBaseUrl,
    Boolean useFullUrl,
    String apiKey) {}
