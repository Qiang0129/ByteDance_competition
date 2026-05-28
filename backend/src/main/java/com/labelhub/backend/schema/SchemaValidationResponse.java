package com.labelhub.backend.schema;

import java.util.List;

public record SchemaValidationResponse(
    boolean valid,
    List<SchemaDiagnosticResponse> errors,
    List<SchemaDiagnosticResponse> warnings) {}
