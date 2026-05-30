package com.labelhub.backend.annotation;

import java.util.List;

public record BatchSubmitResponse(
    String taskId,
    int submittedCount,
    List<String> annotationIds) {}
