package com.labelhub.backend.dataset;

public record DatasetItemPayload(
    String itemKey,
    String rawPayloadJson,
    String mediaType,
    String mediaUrl,
    String contentMarkdown) {}
