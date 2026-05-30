package com.labelhub.backend.ai;

public record AiModelConfigRequest(
    String providerName,
    String notes,
    String licenseUrl,
    String apiBaseUrl,
    Boolean useFullUrl,
    String modelName,
    String reasoningEffort,
    String wireApi,
    String apiKey) {}
