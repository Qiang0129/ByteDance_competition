package com.labelhub.backend.schema;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.dataset.DatasetRecord;
import com.labelhub.backend.dataset.DatasetRepository;
import com.labelhub.backend.task.PageResponse;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SchemaService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final String DEFAULT_SCHEMA_TAB_ID = "annotation";
  private static final String DEFAULT_SCHEMA_TAB_LABEL = "标注";

  private final SchemaRepository schemaRepository;
  private final DatasetRepository datasetRepository;
  private final SchemaDefinitionValidator schemaDefinitionValidator;
  private final ObjectMapper objectMapper;

  public SchemaService(
      SchemaRepository schemaRepository,
      DatasetRepository datasetRepository,
      SchemaDefinitionValidator schemaDefinitionValidator,
      ObjectMapper objectMapper) {
    this.schemaRepository = schemaRepository;
    this.datasetRepository = datasetRepository;
    this.schemaDefinitionValidator = schemaDefinitionValidator;
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

  public SchemaValidationResponse validateSchema(
      Authentication authentication,
      SchemaValidationRequest request) {
    requireOwner(authentication);
    if (request != null && request.tabs() != null) {
      normalizeTabs(request.tabs());
    }
    return schemaDefinitionValidator.validate(
        request == null || request.fields() == null
            ? null
            : normalizeFields(request.fields()));
  }

  @Transactional
  public SchemaVersionResponse createStandaloneDraft(
      Authentication authentication,
      CreateSchemaDraftRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    JsonNode fields = normalizeFields(requireFieldArray(request.fields()));
    JsonNode tabs = normalizeTabs(request.tabs());
    ensureValidSchema(fields);
    DatasetBinding dataset = resolveDatasetBinding(owner.id(), request.datasetId());
    String schemaJson = writeSchema(
        normalizeName(request.name()),
        normalizeDescription(request.description()),
        dataset,
        tabs,
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
    JsonNode fields = normalizeFields(requireFieldArray(request.fields()));
    JsonNode tabs = normalizeTabs(request.tabs());
    ensureValidSchema(fields);
    DatasetBinding dataset = resolveDatasetBinding(owner.id(), request.datasetId());
    String schemaJson = writeSchema(
        normalizeName(request.name()),
        normalizeDescription(request.description()),
        dataset,
        tabs,
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
    if (!isDraftStatus(current.status())) {
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
    DatasetBinding dataset = request.datasetId() == null
        ? snapshot.dataset()
        : resolveDatasetBinding(owner.id(), request.datasetId());
    JsonNode fields = normalizeFields(requireFieldArray(request.fields()));
    JsonNode tabs = request.tabs() == null ? snapshot.tabs() : normalizeTabs(request.tabs());
    ensureValidSchema(fields);
    Long taskId = parseOptionalId(request.taskId(), "INVALID_TASK_ID");
    if (taskId != null) {
      ensureTaskOwner(owner.id(), taskId);
    }

    int version = current.version();
    if (taskId != null && !Objects.equals(taskId, current.taskId())) {
      version = schemaRepository.nextTaskVersion(taskId);
    }

    schemaRepository.updateDraft(versionId, taskId, version, writeSchema(name, description, dataset, tabs, fields));
    return toVersion(loadOwnerSchema(owner.id(), versionId));
  }

  @Transactional
  public SchemaVersionResponse publish(Authentication authentication, long versionId) {
    AuthenticatedUser owner = requireOwner(authentication);
    SchemaRecord current = loadOwnerSchema(owner.id(), versionId);
    SchemaSnapshot snapshot = readSnapshot(current);
    JsonNode fields = normalizeFields(snapshot.fields());
    JsonNode tabs = normalizeTabs(snapshot.tabs());
    ensureValidSchema(fields);
    schemaRepository.updateDraft(
        versionId,
        current.taskId(),
        current.version(),
        writeSchema(snapshot.name(), snapshot.description(), snapshot.dataset(), tabs, fields));
    schemaRepository.publish(versionId);
    return toVersion(loadOwnerSchema(owner.id(), versionId));
  }

  @Transactional
  public SchemaVersionResponse withdraw(Authentication authentication, long versionId) {
    AuthenticatedUser owner = requireOwner(authentication);
    SchemaRecord current = loadOwnerSchema(owner.id(), versionId);
    if (!"published".equals(normalizeStatus(current.status()))) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_NOT_PUBLISHED",
          "only published schema can be withdrawn");
    }
    schemaRepository.withdraw(versionId);
    return toVersion(loadOwnerSchema(owner.id(), versionId));
  }

  @Transactional
  public void deleteDraft(Authentication authentication, long versionId) {
    AuthenticatedUser owner = requireOwner(authentication);
    SchemaRecord current = schemaRepository.findOwnerSchemaIncludingDeleted(owner.id(), versionId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found"));
    if (current.deletedAt() != null) {
      return;
    }
    if (!isDraftStatus(current.status())) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "SCHEMA_NOT_DRAFT",
          "only draft schema can be deleted");
    }
    int deleted = schemaRepository.deleteDraft(owner.id(), versionId);
    if (deleted == 0) {
      throw new ApiException(HttpStatus.NOT_FOUND, "SCHEMA_NOT_FOUND", "schema not found");
    }
  }

  private void ensureValidSchema(JsonNode fields) {
    SchemaValidationResponse validation = schemaDefinitionValidator.validate(fields);
    if (validation.valid()) {
      return;
    }
    String message = validation.errors().isEmpty()
        ? "schema validation failed"
        : validation.errors().get(0).message();
    throw new ApiException(HttpStatus.BAD_REQUEST, "SCHEMA_VALIDATION_FAILED", message);
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

  private DatasetBinding resolveDatasetBinding(long ownerId, String datasetId) {
    Long parsed = parseOptionalId(datasetId, "INVALID_DATASET_ID");
    if (parsed == null) {
      return DatasetBinding.empty();
    }
    DatasetRecord dataset = datasetRepository.findOwnerDataset(ownerId, parsed)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DATASET_NOT_FOUND", "dataset not found"));
    return new DatasetBinding(Long.toString(dataset.id()), dataset.fileName());
  }

  private SchemaSummaryResponse toSummary(SchemaRecord record) {
    SchemaSnapshot snapshot = readSnapshot(record);
    return new SchemaSummaryResponse(
        Long.toString(record.id()),
        "r" + record.version(),
        snapshot.name(),
        record.taskId() == null ? "" : Long.toString(record.taskId()),
        record.taskTitle(),
        snapshot.datasetId(),
        snapshot.datasetName(),
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
        snapshot.datasetId(),
        snapshot.datasetName(),
        normalizeStatus(record.status()),
        snapshot.tabs(),
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
      String datasetId = text(root, "datasetId");
      String datasetName = text(root, "datasetName");
      JsonNode tabsNode = root.path("tabs");
      JsonNode fieldsNode = root.path("fields");
      ArrayNode tabs = normalizeTabs(tabsNode.isArray()
          ? tabsNode
          : objectMapper.createArrayNode());
      ArrayNode fields = normalizeFields(fieldsNode.isArray()
          ? fieldsNode
          : objectMapper.createArrayNode());
      return new SchemaSnapshot(name, description, new DatasetBinding(datasetId, datasetName), tabs, fields);
    } catch (JsonProcessingException exception) {
      return new SchemaSnapshot(
          "未命名模板",
          "",
          DatasetBinding.empty(),
          normalizeTabs(null),
          objectMapper.createArrayNode());
    }
  }

  private String writeSchema(String name, String description, DatasetBinding dataset, JsonNode tabs, JsonNode fields) {
    ObjectNode root = objectMapper.createObjectNode();
    root.put("name", name);
    root.put("description", description == null ? "" : description);
    if (dataset != null && dataset.hasValue()) {
      root.put("datasetId", dataset.id());
      root.put("datasetName", dataset.name() == null ? "" : dataset.name());
    }
    root.set("tabs", normalizeTabs(tabs));
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

  private ArrayNode normalizeTabs(JsonNode tabs) {
    List<ObjectNode> normalizedTabs = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    boolean hasDefaultTab = false;
    if (tabs != null && tabs.isArray()) {
      for (JsonNode tab : tabs) {
        if (!tab.isObject()) {
          continue;
        }
        String id = text(tab, "id");
        String label = text(tab, "label");
        if (id == null || id.isBlank() || seen.contains(id.trim())) {
          continue;
        }
        String normalizedId = id.trim();
        String normalizedLabel = label == null || label.isBlank() ? normalizedId : label.trim();
        if (DEFAULT_SCHEMA_TAB_ID.equals(normalizedId)) {
          hasDefaultTab = true;
        }
        seen.add(normalizedId);
        normalizedTabs.add(schemaTab(normalizedId, normalizedLabel));
      }
    }

    ArrayNode result = objectMapper.createArrayNode();
    if (!hasDefaultTab) {
      result.add(schemaTab(DEFAULT_SCHEMA_TAB_ID, DEFAULT_SCHEMA_TAB_LABEL));
    }
    normalizedTabs.forEach(result::add);
    return result;
  }

  private ObjectNode schemaTab(String id, String label) {
    ObjectNode tab = objectMapper.createObjectNode();
    tab.put("id", id);
    tab.put("label", label);
    return tab;
  }

  private ArrayNode normalizeFields(JsonNode fields) {
    return normalizeFields(fields, fields);
  }

  private ArrayNode normalizeFields(JsonNode fields, JsonNode allFields) {
    ArrayNode normalized = objectMapper.createArrayNode();
    for (JsonNode field : fields) {
      if (!field.isObject()) {
        normalized.add(field.deepCopy());
        continue;
      }
      ObjectNode nextField = ((ObjectNode) field).deepCopy();
      ensureSemanticType(nextField);
      normalizeReactions(nextField, allFields);
      normalizeLayoutChildren(nextField, allFields);
      normalized.add(nextField);
    }
    return normalized;
  }

  private void normalizeReactions(ObjectNode field, JsonNode allFields) {
    JsonNode reactions = field.path("reactions");
    if (!reactions.isArray()) {
      return;
    }
    ArrayNode nextReactions = objectMapper.createArrayNode();
    for (JsonNode reaction : reactions) {
      if (!reaction.isObject()) {
        nextReactions.add(reaction.deepCopy());
        continue;
      }
      ObjectNode nextReaction = ((ObjectNode) reaction).deepCopy();
      normalizeReaction(nextReaction, allFields);
      nextReactions.add(nextReaction);
    }
    field.set("reactions", nextReactions);
  }

  private void normalizeLayoutChildren(ObjectNode field, JsonNode allFields) {
    if ("multi-tab".equals(text(field, "kind"))) {
      JsonNode tabs = field.path("componentProps").path("tabs");
      if (!tabs.isArray()) {
        return;
      }
      ObjectNode componentProps = field.path("componentProps").isObject()
          ? ((ObjectNode) field.path("componentProps")).deepCopy()
          : objectMapper.createObjectNode();
      ArrayNode nextTabs = objectMapper.createArrayNode();
      for (JsonNode tab : tabs) {
        if (!tab.isObject()) {
          nextTabs.add(tab.deepCopy());
          continue;
        }
        ObjectNode nextTab = ((ObjectNode) tab).deepCopy();
        JsonNode children = nextTab.path("children");
        if (children.isArray()) {
          nextTab.set("children", normalizeFields(children, allFields));
        }
        nextTabs.add(nextTab);
      }
      componentProps.set("tabs", nextTabs);
      field.set("componentProps", componentProps);
      field.remove("children");
      return;
    }

    JsonNode children = field.path("children");
    if (children.isArray()) {
      field.set("children", normalizeFields(children, allFields));
    }
  }

  private void ensureSemanticType(ObjectNode field) {
    String semanticType = text(field, "semanticType");
    if (semanticType != null && !semanticType.isBlank()) {
      return;
    }
    String kind = text(field, "kind");
    field.put("semanticType", inferSemanticType(kind));
  }

  private String inferSemanticType(String kind) {
    if (kind == null) {
      return "text";
    }
    return switch (kind) {
      case "single-choice" -> "single_choice";
      case "multi-choice" -> "multi_choice";
      case "tags" -> "tags";
      case "json-editor" -> "json";
      case "file-upload" -> "file";
      case "llm-trigger" -> "llm";
      case "show-item" -> "display";
      case "group", "multi-tab" -> "layout";
      default -> "text";
    };
  }

  private void normalizeReaction(ObjectNode reaction, JsonNode fields) {
    String action = text(reaction, "action");
    if ("required".equals(action)) {
      reaction.put("action", "visibleRequired");
    }
    String sourceFieldName = text(reaction, "sourceField");
    String rawValue = text(reaction, "value");
    if (sourceFieldName == null || rawValue == null) {
      return;
    }
    JsonNode sourceField = SchemaFieldTree.findField(fields, sourceFieldName);
    if (sourceField == null) {
      return;
    }
    JsonNode options = sourceField.path("options");
    if (!options.isArray()) {
      return;
    }
    for (JsonNode option : options) {
      String optionValue = text(option, "value");
      String optionLabel = text(option, "label");
      if (rawValue.equals(optionLabel) && optionValue != null && !optionValue.isBlank()) {
        reaction.put("value", optionValue);
        return;
      }
    }
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
    return status != null && "published".equalsIgnoreCase(status.trim()) ? "published" : "draft";
  }

  private boolean isDraftStatus(String status) {
    return "draft".equals(normalizeStatus(status));
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

  private record DatasetBinding(String id, String name) {
    static DatasetBinding empty() {
      return new DatasetBinding(null, null);
    }

    boolean hasValue() {
      return id != null && !id.isBlank();
    }
  }

  private record SchemaSnapshot(
      String name,
      String description,
      DatasetBinding dataset,
      ArrayNode tabs,
      ArrayNode fields) {
    String datasetId() {
      return dataset == null || dataset.id() == null ? "" : dataset.id();
    }

    String datasetName() {
      return dataset == null || dataset.name() == null ? "" : dataset.name();
    }
  }
}
