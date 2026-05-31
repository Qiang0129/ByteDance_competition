package com.labelhub.backend.annotation;

public record ReportIssueRequest(
    String category,
    String description) {}
