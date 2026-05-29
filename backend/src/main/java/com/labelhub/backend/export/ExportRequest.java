package com.labelhub.backend.export;

import com.fasterxml.jackson.databind.JsonNode;

public record ExportRequest(
    String taskId,
    String format,
    JsonNode mappingJson) {}
