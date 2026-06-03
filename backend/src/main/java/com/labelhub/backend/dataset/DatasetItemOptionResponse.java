package com.labelhub.backend.dataset;

public record DatasetItemOptionResponse(
    String itemId,
    String itemKey,
    String label,
    String mediaType,
    String summary) {}
