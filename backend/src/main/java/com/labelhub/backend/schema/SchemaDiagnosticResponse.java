package com.labelhub.backend.schema;

public record SchemaDiagnosticResponse(
    String level,
    String code,
    String message,
    String fieldName) {}
