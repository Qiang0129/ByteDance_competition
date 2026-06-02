package com.labelhub.backend.export;

public record ExportFieldOptionResponse(
    String key,
    String label,
    String source,
    String path,
    boolean defaultSelected) {}
