package com.labelhub.backend.schema;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.PageResponse;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SchemaService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final SchemaRepository schemaRepository;
  private final ObjectMapper objectMapper;

  public SchemaService(SchemaRepository schemaRepository, ObjectMapper objectMapper) {
    this.schemaRepository = schemaRepository;
    this.objectMapper = objectMapper;
  }

  public PageResponse<SchemaSummaryResponse> listSchemas(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    List<SchemaSummaryResponse> items = schemaRepository.listOwnerSchemas(owner.id()).stream()
        .map(this::toSummary)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
  }

  public SchemaVersionResponse getSchema(Authentication authentication, long versionId) {
    AuthenticatedUser owner = requireOwner(authentication);
    return toVersion(loadOwnerSchema(owner.id(), versionId));
  }

  @Transactional
  public SchemaVersionResponse createStandaloneDraft(
      Authentication authentication,
      CreateSchemaDraftRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    JsonNode fields = requireFieldArray(request.fields());
    String schemaJson = writeSchema(
        normalizeName(request.name()),
        normalizeDescription(request.description()),
        fields);
    long schemaId = schemaRepository.createDraft(null, 1, schemaJson, owner.id());
    return toVersion(loadOwnerSchema(owner.id(), schemaId));
  }

  @Transactional
  public SchemaVersionResponse createTaskDraft(
      Authentication authentication,
      long taskId,
      CreateSchemaDraftRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    ensureTaskOwner(owner.id(), taskId);
    JsonNode fields = requireFieldArray(request.fields());
    String schemaJson = writeSchema(
        normalizeName(request.name()),
        normalizeDescription(request.description()),
        fields);
    long schemaId = schemaRepository.createDraft(
        taskId,
        schemaRepository.nextTaskVersion(taskId),
        schemaJson,
        owner.id());
    return toVersion(loadOwnerSchema(owner.id(), schemaId));
  }

  @Transactional
  public SchemaVersionResponse updateDraft(
      Authentication authentication,
      long versionId,
      UpdateSchemaDraftRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    SchemaRecord current = loadOwnerSchema(owner.id(), versionId);
    if (!"draft".equals(current.status())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_ALREADY_PUBLISHED",
          "published schema cannot be updated");
    }

    SchemaSnapshot snapshot = readSnapshot(current);
    String name = request.name() == null ? snapshot.name() : normalizeName(request.name());
    String description = request.description() == null
        ? snapshot.description()
        : normalizeDescription(request.description());
    JsonNode fields = requireFieldArray(request.fields());
    Long taskId = parseOptionalId(request.taskId(), "INVALID_TASK_ID");
    if (taskId != null) {
      ensureTaskOwner(owner.id(), taskId);
    }

    int version = current.version();
    if (taskId != null && !Objects.equals(taskId, current.taskId())) {
      version = schemaRepository.nextTaskVersion(taskId);
    }

    schemaRepository.updateDraft(versionId, taskId, version, writeSchema(name, description, fields));
    return toVersion(loadOwnerSchema(owner.id(), versionId));
  }

  @Transactional
  public SchemaVersionResponse publish(Authentication authentication, long versionId) {
    AuthenticatedUser owner = requireOwner(authentication);
    loadOwnerSchema(owner.id(), versionId);
    schemaRepository.publish(versionId);
    return toVersion(loadOwnerSchema(owner.id(), versionId));
  }

  private SchemaRecord loadOwnerSchema(long ownerId, long versionId) {
    return schemaRepository.findOwnerSchema(ownerId, versionId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
  }

  private void ensureTaskOwner(long ownerId, long taskId) {
    if (!schemaRepository.taskBelongsToOwner(taskId, ownerId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
  }

  private SchemaSummaryResponse toSummary(SchemaRecord record) {
    SchemaSnapshot snapshot = readSnapshot(record);
    return new SchemaSummaryResponse(
        Long.toString(record.id()),
        "r" + record.version(),
        snapshot.name(),
        record.taskId() == null ? "" : Long.toString(record.taskId()),
        record.taskTitle(),
        normalizeStatus(record.status()),
        snapshot.fields().size(),
        formatDateTime(record.updatedAt()),
        resolveCreatedBy(record));
  }

  private SchemaVersionResponse toVersion(SchemaRecord record) {
    SchemaSnapshot snapshot = readSnapshot(record);
    return new SchemaVersionResponse(
        Long.toString(record.id()),
        "r" + record.version(),
        record.taskId() == null ? "" : Long.toString(record.taskId()),
        record.taskTitle(),
        snapshot.name(),
        snapshot.description(),
        normalizeStatus(record.status()),
        snapshot.fields(),
        formatDateTime(record.updatedAt()),
        resolveCreatedBy(record));
  }

  private SchemaSnapshot readSnapshot(SchemaRecord record) {
    try {
      JsonNode root = objectMapper.readTree(record.schemaJson());
      String name = text(root, "name");
      if (name == null || name.isBlank()) {
        name = text(root, "schemaLabel");
      }
      if (name == null || name.isBlank()) {
        name = "未命名模板";
      }
      String description = text(root, "description");
      JsonNode fieldsNode = root.path("fields");
      ArrayNode fields = fieldsNode.isArray()
          ? fieldsNode.deepCopy()
          : objectMapper.createArrayNode();
      return new SchemaSnapshot(name, description, fields);
    } catch (JsonProcessingException exception) {
      return new SchemaSnapshot("未命名模板", "", objectMapper.createArrayNode());
    }
  }

  private String writeSchema(String name, String description, JsonNode fields) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("name", name);
    root.put("description", description == null ? "" : description);
    root.set("fields", fields.deepCopy());
    try {
      return objectMapper.writeValueAsString(root);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SCHEMA_JSON", "schema cannot be serialized");
    }
  }

  private JsonNode requireFieldArray(JsonNode fields) {
    if (fields == null || !fields.isArray()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SCHEMA_FIELDS", "fields must be an array");
    }
    return fields;
  }

  private String normalizeName(String name) {
    if (name == null || name.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SCHEMA_NAME", "schema name is required");
    }
    String normalized = name.trim();
    if (normalized.length() > 255) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SCHEMA_NAME", "schema name is too long");
    }
    return normalized;
  }

  private String normalizeDescription(String description) {
    return description == null ? "" : description.trim();
  }

  private Long parseOptionalId(String id, String code) {
    if (id == null || id.isBlank()) {
      return null;
    }
    try {
      return Long.parseLong(id);
    } catch (NumberFormatException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id format is invalid");
    }
  }

  private String normalizeStatus(String status) {
    return "published".equals(status) ? "published" : "draft";
  }

  private String resolveCreatedBy(SchemaRecord record) {
    if (record.createdByName() != null && !record.createdByName().isBlank()) {
      return record.createdByName();
    }
    return record.createdBy() == null ? "" : Long.toString(record.createdBy());
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private String text(JsonNode node, String field) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return null;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
    }
    return principal;
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    return principal;
  }

  private record SchemaSnapshot(String name, String description, ArrayNode fields) {}
}
