package com.labelhub.backend.export;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.ss.usermodel.Workbook;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExportService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
  private static final Set<String> FORMATS = Set.of("json", "jsonl", "csv", "xlsx");

  private final ExportRepository exportRepository;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;
  private final ExportProperties exportProperties;

  public ExportService(
      ExportRepository exportRepository,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper,
      ExportProperties exportProperties) {
    this.exportRepository = exportRepository;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
    this.exportProperties = exportProperties;
  }

  @Transactional
  public ExportJobResponse createExport(Authentication authentication, ExportRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    long taskId = parseLongId(request == null ? null : request.taskId(), "INVALID_TASK_ID");
    ExportRepository.TaskRecord task = exportRepository.findOwnerTask(owner.id(), taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));

    String format = normalizeFormat(request == null ? null : request.format());
    List<ExportRepository.ExportRowRecord> rows = exportRepository.listExportableRows(task.taskId());
    if (rows.isEmpty()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "NO_EXPORTABLE_ANNOTATION",
          "当前任务没有已审核入库的可导出标注");
    }

    List<ExportColumn> columns = resolveColumns(request == null ? null : request.mappingJson(), task.taskId(), rows);
    long exportId = exportRepository.createExportJob(
        task.taskId(),
        format,
        writeMappingJson(columns),
        owner.id());
    stateMachineService.auditCreation(
        WorkflowEntityType.EXPORT_JOB,
        exportId,
        owner,
        "owner",
        "export.create",
        "pending",
        "export job created",
        Map.of("exportId", exportId, "taskId", task.taskId(), "format", format),
        null);

    ExportRepository.ExportJobRecord job = exportRepository.findOwnerExportJob(owner.id(), exportId)
        .orElseThrow(() -> new IllegalStateException("failed to load export job"));
    return executeOrFail(owner, job, rows, columns);
  }

  public List<ExportJobResponse> listExports(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    return exportRepository.listOwnerExportJobs(owner.id()).stream()
        .map(this::toResponse)
        .toList();
  }

  public ExportOverviewResponse overview(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    LocalDate month = LocalDate.now().withDayOfMonth(1);
    ExportRepository.ExportOverviewRecord record = exportRepository.overview(
        owner.id(),
        month.atStartOfDay(),
        month.plusMonths(1).atStartOfDay());
    return new ExportOverviewResponse(
        record.totalJobs(),
        record.succeededJobs(),
        record.failedJobs(),
        record.monthlyExportedItems(),
        record.monthlyFileSizeBytes());
  }

  public ExportTaskOptionsResponse taskOptions(Authentication authentication, long taskId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.TaskRecord task = exportRepository.findOwnerTask(owner.id(), taskId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found"));
    long exportableCount = exportRepository.countExportableAnnotations(task.taskId());
    List<ExportRepository.ExportRowRecord> rows = exportableCount > 0
        ? exportRepository.listExportableRows(task.taskId())
        : List.of();
    return new ExportTaskOptionsResponse(
        Long.toString(task.taskId()),
        task.taskTitle(),
        exportableCount,
        exportableCount,
        defaultFieldOptions(task.taskId(), rows));
  }

  @Transactional
  public ResponseEntity<Resource> download(Authentication authentication, long exportId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = exportRepository.findOwnerExportJob(owner.id(), exportId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "EXPORT_JOB_NOT_FOUND", "export job not found"));
    Path file = resolveDownloadableFile(job);

    String filename = blankToDefault(job.filename(), "export-" + job.id() + "." + job.format());
    Resource resource = new FileSystemResource(file);
    try {
      long fileSize = Files.size(file);
      return ResponseEntity.ok()
          .contentType(MediaType.parseMediaType(blankToDefault(job.mimeType(), MediaType.APPLICATION_OCTET_STREAM_VALUE)))
          .contentLength(fileSize)
          .header(
              HttpHeaders.CONTENT_DISPOSITION,
              ContentDisposition.attachment()
                  .filename(filename, StandardCharsets.UTF_8)
                  .build()
                  .toString())
          .body(resource);
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.NOT_FOUND, "EXPORT_FILE_NOT_FOUND", "export file not found");
    }
  }

  @Transactional
  public ExportJobResponse confirmDownload(Authentication authentication, long exportId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = lockJob(owner.id(), exportId);
    resolveDownloadableFile(job);
    exportRepository.markDownloaded(job.id());
    return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
  }

  @Transactional
  public ExportJobResponse start(Authentication authentication, long exportId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = lockJob(owner.id(), exportId);
    if ("succeeded".equals(job.status()) || "failed".equals(job.status())) {
      return toResponse(job);
    }
    return executeOrFail(owner, job, null, null);
  }

  @Transactional
  public ExportJobResponse complete(Authentication authentication, long exportId) {
    return start(authentication, exportId);
  }

  @Transactional
  public ExportJobResponse fail(Authentication authentication, long exportId, ExportFailRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = lockJob(owner.id(), exportId);
    if ("failed".equals(job.status()) || "succeeded".equals(job.status())) {
      return toResponse(job);
    }
    String errorSummary = blankToDefault(request == null ? null : request.errorSummary(), "manual export failure");
    exportRepository.markFailed(job.id(), job.progress(), errorSummary);
    stateMachineService.audit(
        WorkflowEntityType.EXPORT_JOB,
        job.id(),
        owner,
        "owner",
        "export.fail",
        job.status(),
        "failed",
        errorSummary,
        Map.of("exportId", job.id(), "status", job.status()),
        Map.of("exportId", job.id(), "status", "failed"),
        null);
    return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
  }

  private ExportJobResponse executeOrFail(
      AuthenticatedUser owner,
      ExportRepository.ExportJobRecord job,
      List<ExportRepository.ExportRowRecord> preparedRows,
      List<ExportColumn> preparedColumns) {
    try {
      return executeExport(owner, job, preparedRows, preparedColumns);
    } catch (RuntimeException | IOException exception) {
      String summary = summarizeFailure(exception);
      int progress = Math.max(job.progress(), 10);
      exportRepository.markFailed(job.id(), progress, summary);
      String fromState = "running";
      stateMachineService.audit(
          WorkflowEntityType.EXPORT_JOB,
          job.id(),
          owner,
          "owner",
          "export.fail",
          fromState,
          "failed",
          summary,
          Map.of("exportId", job.id(), "status", fromState),
          Map.of("exportId", job.id(), "status", "failed", "errorSummary", summary),
          null);
      return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
    }
  }

  private ExportJobResponse executeExport(
      AuthenticatedUser owner,
      ExportRepository.ExportJobRecord job,
      List<ExportRepository.ExportRowRecord> preparedRows,
      List<ExportColumn> preparedColumns) throws IOException {
    if ("succeeded".equals(job.status()) || "failed".equals(job.status())) {
      return toResponse(job);
    }

    if ("pending".equals(job.status())) {
      exportRepository.markRunning(job.id());
      stateMachineService.audit(
          WorkflowEntityType.EXPORT_JOB,
          job.id(),
          owner,
          "owner",
          "export.start",
          "pending",
          "running",
          "export job started",
          Map.of("exportId", job.id(), "status", "pending"),
          Map.of("exportId", job.id(), "status", "running"),
          null);
    }

    List<ExportRepository.ExportRowRecord> rows = preparedRows == null
        ? exportRepository.listExportableRows(job.taskId())
        : preparedRows;
    if (rows.isEmpty()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "NO_EXPORTABLE_ANNOTATION",
          "当前任务没有已审核入库的可导出标注");
    }
    List<ExportColumn> columns = preparedColumns == null
        ? resolveColumns(readJsonOrNull(job.mappingJson()), job.taskId(), rows)
        : preparedColumns;

    Path root = storageRoot();
    String extension = extension(job.format());
    String filename = "export-" + job.id() + "." + extension;
    String storageKey = "owner-" + owner.id() + "/" + filename;
    Path target = root.resolve(storageKey).normalize();
    if (!target.startsWith(root)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_EXPORT_PATH", "export path is invalid");
    }

    Files.createDirectories(target.getParent());
    writeExportFile(target, job.format(), columns, rows);
    long fileSize = Files.size(target);
    String checksum = sha256(target);
    long fileId = exportRepository.createFile(
        owner.id(),
        storageKey,
        filename,
        mimeType(job.format()),
        fileSize,
        checksum);

    for (ExportRepository.ExportRowRecord row : rows) {
      String annotationStatus = blankToDefault(row.annotationStatus(), "accepted");
      stateMachineService.audit(
          WorkflowEntityType.ANNOTATION,
          row.annotationId(),
          owner,
          "owner",
          "export.include",
          annotationStatus,
          annotationStatus,
          "annotation included in export",
          Map.of("annotationId", row.annotationId(), "status", annotationStatus, "exportId", job.id()),
          Map.of("annotationId", row.annotationId(), "status", annotationStatus, "exportId", job.id()),
          null);
    }
    exportRepository.markSucceeded(job.id(), fileId, rows.size());
    stateMachineService.audit(
        WorkflowEntityType.EXPORT_JOB,
        job.id(),
        owner,
        "owner",
        "export.complete",
        "running",
        "succeeded",
        "export job completed",
        Map.of("exportId", job.id(), "status", "running"),
        Map.of(
            "exportId", job.id(),
            "status", "succeeded",
            "fileId", fileId,
            "exportedCount", rows.size(),
            "fileSizeBytes", fileSize),
        null);

    return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
  }

  private void writeExportFile(
      Path target,
      String format,
      List<ExportColumn> columns,
      List<ExportRepository.ExportRowRecord> rows) throws IOException {
    switch (format) {
      case "json" -> writeJson(target, columns, rows);
      case "jsonl" -> writeJsonl(target, columns, rows);
      case "csv" -> writeCsv(target, columns, rows);
      case "xlsx" -> writeXlsx(target, columns, rows);
      default -> throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_EXPORT_FORMAT", "unsupported export format");
    }
  }

  private void writeJson(
      Path target,
      List<ExportColumn> columns,
      List<ExportRepository.ExportRowRecord> rows) throws IOException {
    List<Map<String, Object>> exportRows = rows.stream()
        .map(row -> exportObject(row, columns, false))
        .toList();
    objectMapper.writerWithDefaultPrettyPrinter().writeValue(target.toFile(), exportRows);
  }

  private void writeJsonl(
      Path target,
      List<ExportColumn> columns,
      List<ExportRepository.ExportRowRecord> rows) throws IOException {
    try (BufferedWriter writer = Files.newBufferedWriter(target, StandardCharsets.UTF_8)) {
      for (ExportRepository.ExportRowRecord row : rows) {
        writer.write(objectMapper.writeValueAsString(exportObject(row, columns, false)));
        writer.newLine();
      }
    }
  }

  private void writeCsv(
      Path target,
      List<ExportColumn> columns,
      List<ExportRepository.ExportRowRecord> rows) throws IOException {
    try (BufferedWriter writer = Files.newBufferedWriter(target, StandardCharsets.UTF_8)) {
      writer.write(csvLine(columns.stream().map(ExportColumn::label).toList()));
      writer.newLine();
      for (ExportRepository.ExportRowRecord row : rows) {
        writer.write(csvLine(columns.stream()
            .map(column -> cellText(valueForColumn(row, column)))
            .toList()));
        writer.newLine();
      }
    }
  }

  private void writeXlsx(
      Path target,
      List<ExportColumn> columns,
      List<ExportRepository.ExportRowRecord> rows) throws IOException {
    try (Workbook workbook = new XSSFWorkbook(); OutputStream output = Files.newOutputStream(target)) {
      Sheet sheet = workbook.createSheet("exports");
      Row header = sheet.createRow(0);
      for (int index = 0; index < columns.size(); index++) {
        header.createCell(index).setCellValue(columns.get(index).label());
      }
      int rowIndex = 1;
      for (ExportRepository.ExportRowRecord exportRow : rows) {
        Row sheetRow = sheet.createRow(rowIndex++);
        for (int columnIndex = 0; columnIndex < columns.size(); columnIndex++) {
          Cell cell = sheetRow.createCell(columnIndex);
          writeCell(cell, valueForColumn(exportRow, columns.get(columnIndex)));
        }
      }
      for (int index = 0; index < Math.min(columns.size(), 30); index++) {
        sheet.autoSizeColumn(index);
      }
      workbook.write(output);
    }
  }

  private Map<String, Object> exportObject(
      ExportRepository.ExportRowRecord row,
      List<ExportColumn> columns,
      boolean stringifyComplexValues) {
    Map<String, Object> values = new LinkedHashMap<>();
    for (ExportColumn column : columns) {
      Object value = valueForColumn(row, column);
      values.put(column.label(), stringifyComplexValues ? cellText(value) : jsonValue(value));
    }
    return values;
  }

  private Object valueForColumn(ExportRepository.ExportRowRecord row, ExportColumn column) {
    String source = blankToDefault(column.source(), "system").toLowerCase(Locale.ROOT);
    String path = column.path();
    return switch (source) {
      case "answer" -> jsonPath(readJsonOrNull(row.answerJson()), path);
      case "item", "raw_payload", "rawpayload" -> path == null || path.isBlank()
          ? readJsonOrNull(row.rawPayloadJson())
          : jsonPath(readJsonOrNull(row.rawPayloadJson()), path);
      default -> systemValue(row, path);
    };
  }

  private Object systemValue(ExportRepository.ExportRowRecord row, String path) {
    return switch (blankToDefault(path, "")) {
      case "taskTitle" -> row.taskTitle();
      case "itemIndex" -> row.itemIndex();
      case "itemId" -> row.itemId();
      case "assignmentId" -> row.assignmentId();
      case "annotationId" -> row.annotationId();
      case "labelerName" -> row.labelerName();
      case "submittedAt" -> formatDateTime(row.submittedAt());
      case "reviewerName" -> row.reviewerName();
      case "humanDecision" -> row.humanDecision();
      case "humanReason" -> row.humanReason();
      case "humanReviewedAt" -> formatDateTime(row.humanReviewedAt());
      case "aiDecision" -> row.aiDecision();
      case "aiTotalScore" -> row.aiTotalScore();
      case "rawPayload" -> readJsonOrNull(row.rawPayloadJson());
      case "contentMarkdown" -> resolveOriginalContent(row);
      case "mediaType" -> row.mediaType();
      case "mediaUrl" -> row.mediaUrl();
      case "answerJson" -> readJsonOrNull(row.answerJson());
      default -> null;
    };
  }

  private Object resolveOriginalContent(ExportRepository.ExportRowRecord row) {
    if (row.contentMarkdown() != null && !row.contentMarkdown().isBlank()) {
      return row.contentMarkdown();
    }

    JsonNode fallback = firstReadableJsonNode(
        readJsonOrNull(row.rawPayloadJson()),
        List.of(
            "content_markdown",
            "prompt",
            "question",
            "content",
            "text",
            "input",
            "query",
            "title",
            "body",
            "description",
            "raw_text"));
    if (fallback == null) {
      return "";
    }
    if (fallback.isTextual()) {
      return fallback.asText();
    }
    return fallback;
  }

  private JsonNode firstReadableJsonNode(JsonNode root, List<String> paths) {
    if (root == null || root.isMissingNode() || root.isNull()) {
      return null;
    }
    for (String path : paths) {
      JsonNode node = jsonPath(root, path);
      if (isReadableNode(node)) {
        return node;
      }
    }
    return null;
  }

  private boolean isReadableNode(JsonNode node) {
    if (node == null || node.isMissingNode() || node.isNull()) {
      return false;
    }
    if (node.isTextual()) {
      return !node.asText().isBlank();
    }
    if (node.isArray()) {
      return !node.isEmpty();
    }
    if (node.isObject()) {
      return node.size() > 0;
    }
    return true;
  }

  private JsonNode jsonPath(JsonNode root, String path) {
    if (root == null || root.isMissingNode() || root.isNull()) {
      return null;
    }
    if (path == null || path.isBlank()) {
      return root;
    }
    JsonNode current = root;
    for (String part : path.split("\\.")) {
      if (part.isBlank()) {
        continue;
      }
      if (!current.isObject() || !current.has(part)) {
        return null;
      }
      current = current.get(part);
    }
    return current == null || current.isMissingNode() || current.isNull() ? null : current;
  }

  private Object jsonValue(Object value) {
    if (value instanceof NullNode) {
      return null;
    }
    return value;
  }

  private String cellText(Object value) {
    if (value == null || value instanceof NullNode) {
      return "";
    }
    if (value instanceof JsonNode node) {
      if (node.isNull() || node.isMissingNode()) {
        return "";
      }
      if (node.isValueNode()) {
        return node.asText();
      }
      String attachmentNames = attachmentNames(node);
      if (attachmentNames != null) {
        return attachmentNames;
      }
      try {
        return objectMapper.writeValueAsString(node);
      } catch (JsonProcessingException exception) {
        return node.toString();
      }
    }
    if (value instanceof LocalDateTime dateTime) {
      return formatDateTime(dateTime);
    }
    return String.valueOf(value);
  }

  private String attachmentNames(JsonNode node) {
    if (!node.isArray() || node.isEmpty()) {
      return null;
    }
    List<String> names = new ArrayList<>();
    for (JsonNode item : node) {
      if (!item.isObject() || !item.path("fileId").isTextual() || !item.path("name").isTextual()) {
        return null;
      }
      String name = item.path("name").asText("");
      if (!name.isBlank()) {
        names.add(name);
      }
    }
    return String.join("、", names);
  }

  private void writeCell(Cell cell, Object value) {
    if (value == null || value instanceof NullNode) {
      cell.setBlank();
      return;
    }
    if (value instanceof Number number) {
      cell.setCellValue(number.doubleValue());
      return;
    }
    if (value instanceof Boolean bool) {
      cell.setCellValue(bool);
      return;
    }
    if (value instanceof JsonNode node && node.isNumber()) {
      cell.setCellValue(node.asDouble());
      return;
    }
    if (value instanceof JsonNode node && node.isBoolean()) {
      cell.setCellValue(node.asBoolean());
      return;
    }
    cell.setCellValue(cellText(value));
  }

  private String csvLine(List<String> cells) {
    return cells.stream()
        .map(this::csvCell)
        .reduce((left, right) -> left + "," + right)
        .orElse("");
  }

  private String csvCell(String value) {
    String safe = value == null ? "" : value;
    if (safe.contains("\"") || safe.contains(",") || safe.contains("\n") || safe.contains("\r")) {
      return "\"" + safe.replace("\"", "\"\"") + "\"";
    }
    return safe;
  }

  private List<ExportColumn> resolveColumns(
      JsonNode mappingJson,
      long taskId,
      List<ExportRepository.ExportRowRecord> rows) {
    List<ExportColumn> requested = parseColumns(mappingJson);
    if (!requested.isEmpty()) {
      return requested;
    }
    return defaultFieldOptions(taskId, rows).stream()
        .filter(ExportFieldOptionResponse::defaultSelected)
        .map(option -> new ExportColumn(option.key(), option.label(), option.source(), option.path()))
        .toList();
  }

  private List<ExportColumn> parseColumns(JsonNode mappingJson) {
    if (mappingJson == null || !mappingJson.has("columns") || !mappingJson.get("columns").isArray()) {
      return List.of();
    }
    List<ExportColumn> columns = new ArrayList<>();
    Set<String> keys = new LinkedHashSet<>();
    for (JsonNode node : mappingJson.get("columns")) {
      String key = text(node, "key", "");
      String label = text(node, "label", "");
      String source = text(node, "source", "");
      String path = text(node, "path", "");
      if (key.isBlank() || label.isBlank() || source.isBlank()) {
        continue;
      }
      if (keys.add(key)) {
        columns.add(new ExportColumn(key, label, source, path));
      }
    }
    return columns;
  }

  private String writeMappingJson(List<ExportColumn> columns) {
    ObjectNode root = objectMapper.createObjectNode();
    ArrayNode columnNodes = root.putArray("columns");
    for (ExportColumn column : columns) {
      ObjectNode node = columnNodes.addObject();
      node.put("key", column.key());
      node.put("label", column.label());
      node.put("source", column.source());
      node.put("path", column.path());
    }
    try {
      return objectMapper.writeValueAsString(root);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "mappingJson cannot be serialized");
    }
  }

  private List<ExportFieldOptionResponse> defaultFieldOptions(
      long taskId,
      List<ExportRepository.ExportRowRecord> rows) {
    List<ExportFieldOptionResponse> options = new ArrayList<>();
    options.add(new ExportFieldOptionResponse("system.taskTitle", "任务", "system", "taskTitle", true));
    options.add(new ExportFieldOptionResponse("system.itemIndex", "题号", "system", "itemIndex", true));
    options.add(new ExportFieldOptionResponse("system.itemId", "题目ID", "system", "itemId", true));
    options.add(new ExportFieldOptionResponse("system.assignmentId", "作业ID", "system", "assignmentId", true));
    options.add(new ExportFieldOptionResponse("system.annotationId", "标注ID", "system", "annotationId", true));
    options.add(new ExportFieldOptionResponse("system.labelerName", "标注员", "system", "labelerName", true));
    options.add(new ExportFieldOptionResponse("system.submittedAt", "提交时间", "system", "submittedAt", true));
    options.add(new ExportFieldOptionResponse("system.reviewerName", "审核员", "system", "reviewerName", true));
    options.add(new ExportFieldOptionResponse("system.humanDecision", "人工审核结论", "system", "humanDecision", true));
    options.add(new ExportFieldOptionResponse("system.humanReason", "人工审核原因", "system", "humanReason", true));
    options.add(new ExportFieldOptionResponse("system.humanReviewedAt", "人工审核时间", "system", "humanReviewedAt", true));
    options.add(new ExportFieldOptionResponse("system.aiDecision", "AI 审核结论", "system", "aiDecision", true));
    options.add(new ExportFieldOptionResponse("system.aiTotalScore", "AI 总分", "system", "aiTotalScore", true));
    options.add(new ExportFieldOptionResponse("system.contentMarkdown", "原题内容", "system", "contentMarkdown", true));
    options.add(new ExportFieldOptionResponse("system.rawPayload", "题目原始数据", "system", "rawPayload", false));
    options.add(new ExportFieldOptionResponse("system.answerJson", "答案 JSON", "system", "answerJson", false));
    options.addAll(answerFieldOptions(taskId, rows));
    return options;
  }

  private List<ExportFieldOptionResponse> answerFieldOptions(
      long taskId,
      List<ExportRepository.ExportRowRecord> rows) {
    JsonNode fields = schemaFields(taskId, rows);
    if (fields == null || !fields.isArray()) {
      return List.of();
    }
    List<ExportFieldOptionResponse> options = new ArrayList<>();
    Set<String> names = new LinkedHashSet<>();
    for (JsonNode field : fields) {
      String fieldName = text(field, "fieldName", "");
      if (fieldName.isBlank() || !isSubmittable(field)) {
        continue;
      }
      String label = blankToDefault(text(field, "label", ""), fieldName);
      if (names.add(fieldName)) {
        options.add(new ExportFieldOptionResponse(
            "answer." + fieldName,
            label,
            "answer",
            fieldName,
            true));
      }
    }
    return options;
  }

  private JsonNode schemaFields(long taskId, List<ExportRepository.ExportRowRecord> rows) {
    JsonNode taskSchema = readJsonOrNull(exportRepository.findLatestTaskSchemaJson(taskId).orElse(null));
    JsonNode taskFields = fieldsNode(taskSchema);
    if (taskFields != null) {
      return taskFields;
    }
    for (ExportRepository.ExportRowRecord row : rows) {
      JsonNode rowFields = fieldsNode(readJsonOrNull(row.schemaSnapshotJson()));
      if (rowFields != null) {
        return rowFields;
      }
    }
    return objectMapper.createArrayNode();
  }

  private JsonNode fieldsNode(JsonNode schema) {
    if (schema == null || schema.isNull() || schema.isMissingNode()) {
      return null;
    }
    if (schema.isArray()) {
      return schema;
    }
    JsonNode fields = schema.path("fields");
    return fields.isArray() ? fields : null;
  }

  private boolean isSubmittable(JsonNode field) {
    return switch (semanticType(field)) {
      case "text", "single_choice", "multi_choice", "tags", "file", "json" -> true;
      default -> false;
    };
  }

  private String semanticType(JsonNode field) {
    String semanticType = text(field, "semanticType", "");
    if (!semanticType.isBlank()) {
      return semanticType;
    }
    return switch (text(field, "kind", "")) {
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

  private ExportRepository.ExportJobRecord lockJob(long ownerId, long exportId) {
    return exportRepository.lockOwnerExportJob(ownerId, exportId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "EXPORT_JOB_NOT_FOUND", "export job not found"));
  }

  private Path resolveDownloadableFile(ExportRepository.ExportJobRecord job) {
    if (!"succeeded".equals(job.status()) || job.storageKey() == null || job.storageKey().isBlank()) {
      throw new ApiException(HttpStatus.NOT_FOUND, "EXPORT_FILE_NOT_FOUND", "export file not found");
    }

    Path root = storageRoot();
    Path file = root.resolve(job.storageKey()).normalize();
    if (!file.startsWith(root) || !Files.isRegularFile(file)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "EXPORT_FILE_NOT_FOUND", "export file not found");
    }
    return file;
  }

  private String normalizeFormat(String format) {
    String normalized = format == null || format.isBlank()
        ? "json"
        : format.trim().toLowerCase(Locale.ROOT);
    if (!FORMATS.contains(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_EXPORT_FORMAT", "unsupported export format");
    }
    return normalized;
  }

  private long parseLongId(String value, String code) {
    if (value == null || value.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id is required");
    }
    try {
      return Long.parseLong(value);
    } catch (NumberFormatException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, code, "id format is invalid");
    }
  }

  private JsonNode readJsonOrNull(String json) {
    if (json == null || json.isBlank()) {
      return NullNode.getInstance();
    }
    try {
      return objectMapper.readTree(json);
    } catch (JsonProcessingException exception) {
      return NullNode.getInstance();
    }
  }

  private String text(JsonNode node, String field, String fallback) {
    if (node == null || field == null || !node.has(field) || node.get(field).isNull()) {
      return fallback;
    }
    JsonNode value = node.get(field);
    return value.isTextual() ? value.asText() : value.toString();
  }

  private String extension(String format) {
    return "xlsx".equals(format) ? "xlsx" : format;
  }

  private String mimeType(String format) {
    return switch (format) {
      case "json" -> MediaType.APPLICATION_JSON_VALUE;
      case "jsonl" -> "application/x-ndjson";
      case "csv" -> "text/csv;charset=UTF-8";
      case "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      default -> MediaType.APPLICATION_OCTET_STREAM_VALUE;
    };
  }

  private Path storageRoot() {
    return Paths.get(blankToDefault(exportProperties.getStorageDir(), "data/exports"))
        .toAbsolutePath()
        .normalize();
  }

  private String sha256(Path file) throws IOException {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      try (DigestInputStream input = new DigestInputStream(Files.newInputStream(file), digest)) {
        input.transferTo(OutputStream.nullOutputStream());
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 algorithm is unavailable", exception);
    }
  }

  private String summarizeFailure(Exception exception) {
    if (exception instanceof ApiException apiException) {
      return blankToDefault(apiException.getMessage(), apiException.getCode());
    }
    return blankToDefault(exception.getMessage(), exception.getClass().getSimpleName());
  }

  private ExportJobResponse toResponse(ExportRepository.ExportJobRecord record) {
    return new ExportJobResponse(
        Long.toString(record.id()),
        Long.toString(record.taskId()),
        record.taskTitle(),
        record.format(),
        record.status(),
        record.progress(),
        record.exportedCount(),
        record.fileSize(),
        "succeeded".equals(record.status()) ? "/api/exports/" + record.id() + "/download" : null,
        readJsonOrNull(record.mappingJson()),
        record.errorSummary(),
        formatDateTime(record.createdAt()),
        formatDateTime(record.updatedAt()),
        formatDateTime(record.downloadedAt()),
        record.createdByName());
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
    }
    return principal;
  }

  private record ExportColumn(String key, String label, String source, String path) {}
}
