package com.labelhub.backend.ai;

public record AiModelConfigRuntimeResponse(
    String apiBaseUrl,
    boolean useFullUrl,
    String modelName,
    String reasoningEffort,
    String wireApi,
    int workerConcurrency,
    String apiKey) {}
