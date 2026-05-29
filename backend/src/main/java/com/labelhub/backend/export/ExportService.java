package com.labelhub.backend.export;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.workflow.StateMachineService;
import com.labelhub.backend.workflow.WorkflowEntityType;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExportService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final ExportRepository exportRepository;
  private final StateMachineService stateMachineService;
  private final ObjectMapper objectMapper;

  public ExportService(
      ExportRepository exportRepository,
      StateMachineService stateMachineService,
      ObjectMapper objectMapper) {
    this.exportRepository = exportRepository;
    this.stateMachineService = stateMachineService;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public ExportJobResponse createExport(Authentication authentication, ExportRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    long taskId = parseLongId(request == null ? null : request.taskId(), "INVALID_TASK_ID");
    if (!exportRepository.isTaskOwnedBy(owner.id(), taskId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "task not found");
    }
    if (exportRepository.countAcceptedAnnotations(taskId) <= 0) {
      throw new ApiException(HttpStatus.CONFLICT, "NO_ACCEPTED_ANNOTATION", "export requires accepted annotations");
    }
    String format = normalizeFormat(request == null ? null : request.format());
    long exportId = exportRepository.createExportJob(
        taskId,
        format,
        writeNullableJson(request == null ? null : request.mappingJson()),
        owner.id());
    stateMachineService.auditCreation(
        WorkflowEntityType.EXPORT_JOB,
        exportId,
        owner,
        "owner",
        "export.create",
        "pending",
        "export job created",
        Map.of("exportId", exportId, "taskId", taskId, "format", format),
        null);
    return exportRepository.findOwnerExportJob(owner.id(), exportId)
        .map(this::toResponse)
        .orElseThrow(() -> new IllegalStateException("failed to load export job"));
  }

  public List<ExportJobResponse> listExports(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    return exportRepository.listOwnerExportJobs(owner.id()).stream()
        .map(this::toResponse)
        .toList();
  }

  @Transactional
  public ExportJobResponse start(Authentication authentication, long exportId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = lockJob(owner.id(), exportId);
    exportRepository.updateStatus(job.id(), "running", 10, null);
    stateMachineService.audit(
        WorkflowEntityType.EXPORT_JOB,
        job.id(),
        owner,
        "owner",
        "export.start",
        job.status(),
        "running",
        "export job started",
        Map.of("exportId", job.id(), "status", job.status()),
        Map.of("exportId", job.id(), "status", "running"),
        null);
    return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
  }

  @Transactional
  public ExportJobResponse complete(Authentication authentication, long exportId) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = lockJob(owner.id(), exportId);
    List<Long> annotationIds = exportRepository.listAcceptedAnnotationIds(job.taskId());
    exportRepository.updateStatus(job.id(), "succeeded", 100, null);
    exportRepository.markAcceptedAnnotationsExported(job.taskId());
    stateMachineService.audit(
        WorkflowEntityType.EXPORT_JOB,
        job.id(),
        owner,
        "owner",
        "export.complete",
        job.status(),
        "succeeded",
        "export job completed",
        Map.of("exportId", job.id(), "status", job.status()),
        Map.of("exportId", job.id(), "status", "succeeded"),
        null);
    for (Long annotationId : annotationIds) {
      stateMachineService.audit(
          WorkflowEntityType.ANNOTATION,
          annotationId,
          owner,
          "owner",
          "export.complete",
          "accepted",
          "exported",
          "accepted annotation exported",
          Map.of("annotationId", annotationId, "status", "accepted"),
          Map.of("annotationId", annotationId, "status", "exported"),
          null);
    }
    return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
  }

  @Transactional
  public ExportJobResponse fail(Authentication authentication, long exportId, ExportFailRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    ExportRepository.ExportJobRecord job = lockJob(owner.id(), exportId);
    exportRepository.updateStatus(job.id(), "failed", job.progress(), request == null ? null : request.errorSummary());
    stateMachineService.audit(
        WorkflowEntityType.EXPORT_JOB,
        job.id(),
        owner,
        "owner",
        "export.fail",
        job.status(),
        "failed",
        request == null ? null : request.errorSummary(),
        Map.of("exportId", job.id(), "status", job.status()),
        Map.of("exportId", job.id(), "status", "failed"),
        null);
    return exportRepository.findOwnerExportJob(owner.id(), job.id()).map(this::toResponse).orElseThrow();
  }

  private ExportRepository.ExportJobRecord lockJob(long ownerId, long exportId) {
    return exportRepository.lockOwnerExportJob(ownerId, exportId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "EXPORT_JOB_NOT_FOUND", "export job not found"));
  }

  private String normalizeFormat(String format) {
    String normalized = format == null || format.isBlank()
        ? "json"
        : format.trim().toLowerCase(Locale.ROOT);
    if (!List.of("json", "jsonl", "csv", "xlsx").contains(normalized)) {
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

  private String writeNullableJson(Object value) {
    if (value == null) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(value);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_JSON", "json cannot be serialized");
    }
  }

  private ExportJobResponse toResponse(ExportRepository.ExportJobRecord record) {
    return new ExportJobResponse(
        Long.toString(record.id()),
        Long.toString(record.taskId()),
        record.format(),
        record.status(),
        record.progress(),
        record.errorSummary(),
        formatDateTime(record.createdAt()),
        formatDateTime(record.updatedAt()));
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
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
}
