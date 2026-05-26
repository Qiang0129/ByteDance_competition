package com.labelhub.backend.schema;

import com.labelhub.backend.task.PageResponse;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class SchemaController {

  private final SchemaService schemaService;

  public SchemaController(SchemaService schemaService) {
    this.schemaService = schemaService;
  }

  @GetMapping("/schemas")
  public PageResponse<SchemaSummaryResponse> listSchemas(Authentication authentication) {
    return schemaService.listSchemas(authentication);
  }

  @GetMapping("/schemas/{versionId}")
  public SchemaVersionResponse getSchema(
      Authentication authentication,
      @PathVariable long versionId) {
    return schemaService.getSchema(authentication, versionId);
  }

  @PostMapping("/schemas/draft")
  public SchemaVersionResponse createStandaloneDraft(
      Authentication authentication,
      @Valid @RequestBody CreateSchemaDraftRequest request) {
    return schemaService.createStandaloneDraft(authentication, request);
  }

  @PostMapping("/tasks/{taskId}/schemas/draft")
  public SchemaVersionResponse createTaskDraft(
      Authentication authentication,
      @PathVariable long taskId,
      @Valid @RequestBody CreateSchemaDraftRequest request) {
    return schemaService.createTaskDraft(authentication, taskId, request);
  }

  @PutMapping("/schemas/{versionId}/draft")
  public SchemaVersionResponse updateDraft(
      Authentication authentication,
      @PathVariable long versionId,
      @Valid @RequestBody UpdateSchemaDraftRequest request) {
    return schemaService.updateDraft(authentication, versionId, request);
  }

  @PostMapping("/schemas/{versionId}/publish")
  public SchemaVersionResponse publish(
      Authentication authentication,
      @PathVariable long versionId) {
    return schemaService.publish(authentication, versionId);
  }
}
