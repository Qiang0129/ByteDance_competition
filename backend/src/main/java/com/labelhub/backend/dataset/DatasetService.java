package com.labelhub.backend.dataset;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.PageResponse;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class DatasetService {

  private static final Set<String> ALLOWED_MEDIA_TYPES = Set.of("text", "image", "video", "markdown");
  private static final int MAX_IMPORT_BYTES = 20 * 1024 * 1024;
  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final DatasetRepository datasetRepository;
  private final DatasetFileParser datasetFileParser;
  private final ObjectMapper objectMapper;

  public DatasetService(
      DatasetRepository datasetRepository,
      DatasetFileParser datasetFileParser,
      ObjectMapper objectMapper) {
    this.datasetRepository = datasetRepository;
    this.datasetFileParser = datasetFileParser;
    this.objectMapper = objectMapper;
  }

  public PageResponse<DatasetResponse> listDatasets(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    List<DatasetResponse> items = datasetRepository.listOwnerDatasets(owner.id()).stream()
        .map(this::toResponse)
        .toList();
    return new PageResponse<>(items, 1, items.size(), items.size());
  }

  public List<JsonNode> listItems(Authentication authentication, long datasetId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ensureDataset(owner.id(), datasetId);
    return datasetRepository.listItemRawPayloads(owner.id(), datasetId).stream()
        .map(this::readJson)
        .toList();
  }

  @Transactional
  public DatasetResponse createDataset(Authentication authentication, CreateDatasetRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    Long taskId = parseOptionalId(request.taskId(), "INVALID_TASK_ID");
    ensureTaskOwner(owner.id(), taskId);
    String kind = normalizeKind(request.kind());
    String name = normalizeName(request.name(), kind);
    long fileId = datasetRepository.createFile(
        owner.id(),
        storageKey("dataset-meta", owner.id(), name),
        name,
        "application/vnd.labelhub.dataset",
        0L,
        null);
    long datasetId = datasetRepository.createDataset(
        taskId,
        fileId,
        kind,
        "imported",
        0,
        0,
        0,
        null);
    return loadResponse(owner.id(), datasetId);
  }

  @Transactional
  public DatasetResponse importDataset(
      Authentication authentication,
      String taskIdValue,
      String kindValue,
      String nameValue,
      MultipartFile file) {
    AuthenticatedUser owner = requireOwner(authentication);
    Long taskId = parseOptionalId(taskIdValue, "INVALID_TASK_ID");
    ensureTaskOwner(owner.id(), taskId);
    String kind = normalizeKind(kindValue);
    if (file == null || file.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "EMPTY_DATASET_FILE", "dataset file is required");
    }

    byte[] bytes = readBytes(file);
    if (bytes.length > MAX_IMPORT_BYTES) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "DATASET_FILE_TOO_LARGE", "dataset file must be <= 20MB");
    }

    String originalFilename = file.getOriginalFilename();
    List<JsonNode> rows = datasetFileParser.parse(originalFilename, bytes);
    String datasetName = normalizeName(
        nameValue == null || nameValue.isBlank() ? originalFilename : nameValue,
        kind);
    long fileId = datasetRepository.createFile(
        owner.id(),
        storageKey("dataset-imports", owner.id(), originalFilename),
        datasetName,
        file.getContentType(),
        (long) bytes.length,
        checksum(bytes));
    long datasetId = datasetRepository.createDataset(
        taskId,
        fileId,
        kind,
        "imported",
        rows.size(),
        rows.size(),
        0,
        null);
    datasetRepository.insertItems(taskId, datasetId, toPayloads(rows));
    return loadResponse(owner.id(), datasetId);
  }

  @Transactional
  public DatasetResponse importItemsToDataset(
      Authentication authentication,
      long datasetId,
      MultipartFile file) {
    AuthenticatedUser owner = requireOwner(authentication);
    DatasetRecord dataset = datasetRepository.findOwnerDataset(owner.id(), datasetId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DATASET_NOT_FOUND", "dataset not found"));
    if (file == null || file.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "EMPTY_DATASET_FILE", "dataset file is required");
    }

    byte[] bytes = readBytes(file);
    if (bytes.length > MAX_IMPORT_BYTES) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "DATASET_FILE_TOO_LARGE", "dataset file must be <= 20MB");
    }

    List<JsonNode> rows = datasetFileParser.parse(file.getOriginalFilename(), bytes);
    datasetRepository.insertItems(dataset.taskId(), dataset.id(), toPayloads(rows));
    datasetRepository.addDatasetImportCounts(dataset.id(), rows.size(), bytes.length);
    return loadResponse(owner.id(), dataset.id());
  }

  private List<DatasetItemPayload> toPayloads(List<JsonNode> rows) {
    List<DatasetItemPayload> payloads = new ArrayList<>();
    for (int index = 0; index < rows.size(); index++) {
      ObjectNode payload = asObject(rows.get(index));
      String itemKey = text(payload, "id");
      if (itemKey == null || itemKey.isBlank()) {
        itemKey = "row-" + String.format(Locale.ROOT, "%05d", index + 1);
        payload.put("id", itemKey);
      }
      String mediaType = normalizeMediaType(text(payload, "media_type"), text(payload, "content_markdown"));
      try {
        payloads.add(new DatasetItemPayload(
            itemKey,
            objectMapper.writeValueAsString(payload),
            mediaType,
            text(payload, "media_url"),
            text(payload, "content_markdown")));
      } catch (JsonProcessingException exception) {
        throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DATASET_ROW", "dataset row cannot be serialized");
      }
    }
    return payloads;
  }

  private ObjectNode asObject(JsonNode node) {
    if (node instanceof ObjectNode objectNode) {
      return objectNode.deepCopy();
    }
    ObjectNode wrapper = objectMapper.createObjectNode();
    wrapper.set("value", node);
    return wrapper;
  }

  private DatasetResponse loadResponse(long ownerId, long datasetId) {
    DatasetRecord record = datasetRepository.findOwnerDataset(ownerId, datasetId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DATASET_NOT_FOUND", "dataset not found"));
    return toResponse(record);
  }

  private DatasetResponse toResponse(DatasetRecord record) {
    String kind = normalizeKnownKind(record.datasetType());
    Map<String, Integer> mediaDistribution = datasetRepository.countMediaDistribution(record.id());
    return new DatasetResponse(
        Long.toString(record.id()),
        record.taskId() == null ? "" : Long.toString(record.taskId()),
        record.taskTitle(),
        resolveName(record),
        kind,
        resolveDescription(kind, record.taskTitle()),
        record.successCount(),
        record.fileSize() == null ? 0L : record.fileSize(),
        formatDateTime(record.createdAt()),
        mediaDistribution,
        "/api/datasets/" + record.id() + "/items",
        "v1.0",
        record.importStatus(),
        record.errorCount(),
        record.errorSummary());
  }

  private void ensureDataset(long ownerId, long datasetId) {
    datasetRepository.findOwnerDataset(ownerId, datasetId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DATASET_NOT_FOUND", "dataset not found"));
  }

  private void ensureTaskOwner(long ownerId, Long taskId) {
    if (taskId == null) {
      return;
    }
    if (!datasetRepository.taskBelongsToOwner(taskId, ownerId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
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

  private JsonNode readJson(String json) {
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException exception) {
      ObjectNode fallback = objectMapper.createObjectNode();
      fallback.put("id", "invalid-json");
      fallback.put("raw_payload", json);
      return fallback;
    }
  }

  private String normalizeKind(String kind) {
    if (kind == null || kind.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DATASET_KIND", "unsupported dataset kind");
    }
    String normalized = normalizeKindToken(kind);
    if (normalized.length() > 64 || normalized.chars().anyMatch(Character::isISOControl)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DATASET_KIND", "unsupported dataset kind");
    }
    return normalized;
  }

  private String normalizeKnownKind(String kind) {
    if (kind == null || kind.isBlank()) {
      return "qa_quality";
    }
    return normalizeKindToken(kind);
  }

  private String normalizeKindToken(String kind) {
    String normalized = kind.trim().toLowerCase(Locale.ROOT)
        .replace('-', '_')
        .replaceAll("\\s+", "_");
    if (normalized.equals("preference")
        || normalized.equals("preference_compare")
        || normalized.equals("preference_ab")
        || normalized.equals("preference_a_b")) {
      return "preference_compare";
    }
    if (normalized.equals("qa")
        || normalized.equals("qa_quality")
        || normalized.equals("question_answer_quality")) {
      return "qa_quality";
    }
    return normalized;
  }

  private String normalizeMediaType(String mediaType, String contentMarkdown) {
    String normalized = mediaType == null || mediaType.isBlank()
        ? null
        : mediaType.trim().toLowerCase(Locale.ROOT).replace('-', '_');
    if (normalized != null && ALLOWED_MEDIA_TYPES.contains(normalized)) {
      return normalized;
    }
    return contentMarkdown == null || contentMarkdown.isBlank() ? "text" : "markdown";
  }

  private String normalizeName(String name, String kind) {
    if (name != null && !name.isBlank()) {
      return name.trim();
    }
    if ("qa_quality".equals(kind)) {
      return "问答质量评估数据集";
    }
    if ("preference_compare".equals(kind)) {
      return "偏好对比数据集";
    }
    return kind + " 数据集";
  }

  private String resolveName(DatasetRecord record) {
    if (record.fileName() != null && !record.fileName().isBlank()) {
      return record.fileName();
    }
    String kind = normalizeKnownKind(record.datasetType());
    String label = switch (kind) {
      case "preference_compare" -> "偏好对比 A/B";
      case "qa_quality" -> "问答质量评估";
      default -> kind;
    };
    return label + " · #" + record.id();
  }

  private String resolveDescription(String kind, String taskTitle) {
    String typeDesc = switch (kind) {
      case "preference_compare" -> "同一 Prompt 下两条模型回答的偏好选择数据。";
      case "qa_quality" -> "模型答 vs 参考答的单条质量评估数据,保留多模态字段。";
      default -> "自定义数据集类型:" + kind + "。";
    };
    String taskDesc = taskTitle == null || taskTitle.isBlank() ? "未关联任务" : taskTitle;
    return typeDesc + "关联任务:" + taskDesc;
  }

  private String text(JsonNode node, String field) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return null;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private long parseId(String id, String code) {
    try {
      return Long.parseLong(id);
    } catch (NumberFormatException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id format is invalid");
    }
  }

  private Long parseOptionalId(String id, String code) {
    if (id == null || id.isBlank()) {
      return null;
    }
    return parseId(id, code);
  }

  private byte[] readBytes(MultipartFile file) {
    try {
      return file.getBytes();
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DATASET_FILE", "dataset file cannot be read");
    }
  }

  private String checksum(byte[] bytes) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(bytes));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is not available", exception);
    }
  }

  private String storageKey(String prefix, long ownerId, String sourceName) {
    String safeName = sourceName == null || sourceName.isBlank()
        ? "dataset"
        : sourceName.trim().replaceAll("[^A-Za-z0-9._-]", "_");
    return prefix + "/" + ownerId + "/" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"))
        + "-" + UUID.randomUUID() + "-" + safeName;
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }
}
