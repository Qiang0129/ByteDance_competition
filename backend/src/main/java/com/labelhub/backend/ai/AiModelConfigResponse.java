package com.labelhub.backend.ai;

public record AiModelConfigResponse(
    String configId,
    String providerName,
    String notes,
    String licenseUrl,
    String apiBaseUrl,
    boolean useFullUrl,
    String modelName,
    String reasoningEffort,
    String wireApi,
    String apiKeyMask,
    String status,
    String updatedAt,
    String updatedBy) {}
