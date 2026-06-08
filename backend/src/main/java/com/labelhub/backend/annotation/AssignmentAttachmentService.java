package com.labelhub.backend.annotation;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.annotation.AssignmentAttachmentRepository.AssignmentAttachmentContext;
import com.labelhub.backend.annotation.AssignmentAttachmentRepository.AttachmentFileRecord;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

@Service
public class AssignmentAttachmentService {

  public static final long MAX_FILE_SIZE_BYTES = 20L * 1024L * 1024L;
  public static final int MAX_FILES_PER_FIELD = 5;

  private static final DateTimeFormatter STORAGE_TIME = DateTimeFormatter.ofPattern("yyyyMMddHHmmss");
  private static final Set<String> DANGEROUS_EXTENSIONS = Set.of(
      "ade", "adp", "apk", "app", "bat", "bin", "cmd", "com", "cpl", "dll", "dmg", "exe",
      "gadget", "hta", "jar", "js", "jse", "lnk", "msi", "msp", "pif", "ps1", "scr", "sh",
      "vb", "vbe", "vbs", "ws", "wsc", "wsf");
  private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
      "bmp", "csv", "doc", "docx", "gif", "jpeg", "jpg", "json", "md", "pdf", "png", "ppt",
      "pptx", "rtf", "txt", "webp", "xls", "xlsx", "zip");
  private static final Set<String> ALLOWED_MIME_TYPES = Set.of(
      "application/json",
      "application/msword",
      "application/pdf",
      "application/rtf",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/x-zip-compressed",
      "application/zip",
      "text/csv",
      "text/markdown",
      "text/plain");

  private final AssignmentAttachmentRepository attachmentRepository;
  private final AssignmentAttachmentProperties properties;
  private final ObjectMapper objectMapper;

  public AssignmentAttachmentService(
      AssignmentAttachmentRepository attachmentRepository,
      AssignmentAttachmentProperties properties,
      ObjectMapper objectMapper) {
    this.attachmentRepository = attachmentRepository;
    this.properties = properties;
    this.objectMapper = objectMapper;
  }

  @Transactional
  public AssignmentAttachmentResponse upload(
      Authentication authentication,
      long assignmentId,
      String fieldName,
      MultipartFile file) {
    AuthenticatedUser labeler = requireRole(authentication, "labeler");
    AssignmentAttachmentContext assignment = loadAssignment(assignmentId);
    ensureEditableByLabeler(assignment, labeler.id());
    ensureFileUploadField(assignment, fieldName);
    byte[] bytes = readAndValidateFile(file);
    String filename = normalizeFilename(file.getOriginalFilename());
    String mimeType = normalizeMimeType(file.getContentType());
    ensureAllowedFile(filename, mimeType);

    String storageKey = storageKey(assignment.assignmentId(), filename);
    Path target = storageRoot().resolve(storageKey).normalize();
    if (!target.startsWith(storageRoot())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ATTACHMENT_FILE", "invalid file path");
    }
    try {
      Files.createDirectories(target.getParent());
      Files.write(target, bytes);
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "ATTACHMENT_STORAGE_FAILED", "attachment cannot be stored");
    }

    String checksum = checksum(bytes);
    long fileId = attachmentRepository.createFile(
        labeler.id(),
        storageKey,
        filename,
        mimeType,
        (long) bytes.length,
        checksum);
    attachmentRepository.createAssignmentAttachment(
        assignment.assignmentId(),
        fieldName,
        fileId,
        labeler.id());
    return new AssignmentAttachmentResponse(
        Long.toString(fileId),
        filename,
        mimeType,
        (long) bytes.length,
        checksum);
  }

  public AssignmentAttachmentDownload download(
      Authentication authentication,
      long assignmentId,
      long fileId) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    AssignmentAttachmentContext assignment = loadAssignment(assignmentId);
    ensureCanReadAttachment(principal, assignment);
    AttachmentFileRecord file = attachmentRepository.findAttachmentFile(assignmentId, fileId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ATTACHMENT_NOT_FOUND", "attachment not found"));
    Path path = storageRoot().resolve(file.storageKey()).normalize();
    if (!path.startsWith(storageRoot()) || !Files.isRegularFile(path)) {
      throw new ApiException(HttpStatus.NOT_FOUND, "ATTACHMENT_FILE_NOT_FOUND", "attachment file not found");
    }
    long size = file.size() == null ? fileSize(path) : file.size();
    return new AssignmentAttachmentDownload(path, file.filename(), file.mimeType(), size);
  }

  private AssignmentAttachmentContext loadAssignment(long assignmentId) {
    return attachmentRepository.findAssignmentContext(assignmentId)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "assignment not found"));
  }

  private void ensureEditableByLabeler(AssignmentAttachmentContext assignment, long labelerId) {
    if (assignment.labelerId() != labelerId) {
      throw new ApiException(HttpStatus.NOT_FOUND, "ASSIGNMENT_NOT_FOUND", "assignment not found");
    }
    if (assignment.taskDeletedAt() != null || "voided".equals(normalize(assignment.assignmentStatus()))) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_NOT_EDITABLE", "assignment is not editable");
    }
    if (isReturnReworkOpen(assignment)) {
      return;
    }
    String status = normalize(assignment.assignmentStatus());
    String taskStatus = normalize(assignment.taskStatus());
    if (!List.of("claimed", "submitted").contains(status)
        || !"published".equals(taskStatus)
        || isDeadlineExpired(assignment.taskDeadline())) {
      throw new ApiException(HttpStatus.CONFLICT, "ASSIGNMENT_NOT_EDITABLE", "assignment is not editable");
    }
  }

  private void ensureCanReadAttachment(AuthenticatedUser principal, AssignmentAttachmentContext assignment) {
    if (principal.roles().contains("labeler") && principal.id() == assignment.labelerId()) {
      return;
    }
    if (principal.roles().contains("owner") && principal.id() == assignment.ownerId()) {
      return;
    }
    if (principal.roles().contains("reviewer")
        && attachmentRepository.canReviewerAccessAssignment(principal.id(), assignment.assignmentId())) {
      return;
    }
    throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "attachment access is denied");
  }

  private void ensureFileUploadField(AssignmentAttachmentContext assignment, String fieldName) {
    String normalizedFieldName = fieldName == null ? "" : fieldName.trim();
    if (normalizedFieldName.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FIELD_NAME", "fieldName is required");
    }
    JsonNode schema = readSchema(assignment.schemaJson());
    JsonNode fields = schema.path("fields");
    if (!fields.isArray()) {
      throw new ApiException(HttpStatus.CONFLICT, "SCHEMA_NOT_FOUND", "schema fields not found");
    }
    for (JsonNode field : fields) {
      if (normalizedFieldName.equals(field.path("fieldName").asText())
          && "file-upload".equals(field.path("kind").asText())) {
        return;
      }
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ATTACHMENT_FIELD", "field is not a file-upload field");
  }

  private JsonNode readSchema(String schemaJson) {
    if (schemaJson == null || schemaJson.isBlank()) {
      throw new ApiException(HttpStatus.CONFLICT, "SCHEMA_NOT_FOUND", "schema not found");
    }
    try {
      return objectMapper.readTree(schemaJson);
    } catch (JsonProcessingException exception) {
      throw new ApiException(HttpStatus.CONFLICT, "INVALID_SCHEMA_JSON", "schema cannot be parsed");
    }
  }

  private byte[] readAndValidateFile(MultipartFile file) {
    if (file == null || file.isEmpty()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "EMPTY_ATTACHMENT_FILE", "file is required");
    }
    if (file.getSize() > MAX_FILE_SIZE_BYTES) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "ATTACHMENT_TOO_LARGE", "file exceeds 20MB");
    }
    try {
      return file.getBytes();
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ATTACHMENT_FILE", "file cannot be read");
    }
  }

  private void ensureAllowedFile(String filename, String mimeType) {
    String extension = extension(filename);
    if (DANGEROUS_EXTENSIONS.contains(extension)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_ATTACHMENT_TYPE", "file type is not allowed");
    }
    if (mimeType.startsWith("image/")) {
      return;
    }
    if (ALLOWED_MIME_TYPES.contains(mimeType) || ALLOWED_EXTENSIONS.contains(extension)) {
      return;
    }
    throw new ApiException(HttpStatus.BAD_REQUEST, "UNSUPPORTED_ATTACHMENT_TYPE", "file type is not allowed");
  }

  private String normalizeFilename(String filename) {
    String trimmed = filename == null || filename.isBlank() ? "attachment" : filename.trim();
    String normalized = trimmed.replace('\\', '/');
    int slash = normalized.lastIndexOf('/');
    if (slash >= 0) {
      normalized = normalized.substring(slash + 1);
    }
    normalized = normalized.replaceAll("[\\r\\n\\t]", "_");
    return normalized.isBlank() ? "attachment" : normalized;
  }

  private String normalizeMimeType(String mimeType) {
    return mimeType == null || mimeType.isBlank()
        ? "application/octet-stream"
        : mimeType.trim().toLowerCase(Locale.ROOT);
  }

  private String extension(String filename) {
    int dot = filename == null ? -1 : filename.lastIndexOf('.');
    return dot < 0 ? "" : filename.substring(dot + 1).toLowerCase(Locale.ROOT);
  }

  private String storageKey(long assignmentId, String filename) {
    String safeName = filename.replaceAll("[^A-Za-z0-9._-]", "_");
    return "assignment-" + assignmentId + "/"
        + LocalDateTime.now().format(STORAGE_TIME)
        + "-" + UUID.randomUUID()
        + "-" + safeName;
  }

  private Path storageRoot() {
    return Paths.get(properties.getStorageDir() == null || properties.getStorageDir().isBlank()
        ? "data/attachments"
        : properties.getStorageDir())
        .toAbsolutePath()
        .normalize();
  }

  private String checksum(byte[] bytes) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest(bytes));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException("SHA-256 is not available", exception);
    }
  }

  private long fileSize(Path path) {
    try {
      return Files.size(path);
    } catch (IOException exception) {
      throw new ApiException(HttpStatus.NOT_FOUND, "ATTACHMENT_FILE_NOT_FOUND", "attachment file not found");
    }
  }

  private boolean isReturnReworkOpen(AssignmentAttachmentContext assignment) {
    return "returned".equals(normalize(assignment.assignmentStatus()))
        && assignment.resubmitDeadline() != null
        && assignment.resubmitDeadline().isAfter(LocalDateTime.now());
  }

  private boolean isDeadlineExpired(LocalDateTime deadline) {
    return deadline != null && deadline.isBefore(LocalDateTime.now());
  }

  private String normalize(String value) {
    return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
  }

  private AuthenticatedUser requireRole(Authentication authentication, String role) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains(role)) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", role + " role is required");
    }
    return principal;
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    return principal;
  }
}
