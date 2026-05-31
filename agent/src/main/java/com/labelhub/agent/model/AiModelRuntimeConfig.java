package com.labelhub.agent.model;

public record AiModelRuntimeConfig(
    String apiBaseUrl,
    boolean useFullUrl,
    String modelName,
    String reasoningEffort,
    String wireApi,
    Integer workerConcurrency,
    String apiKey) {}
