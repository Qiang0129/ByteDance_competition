package com.labelhub.backend.annotation;

import java.util.Map;

public record BatchSubmitInvalidItem(
    String assignmentId,
    String itemId,
    int index,
    String reason,
    Map<String, String> fieldErrors) {}
