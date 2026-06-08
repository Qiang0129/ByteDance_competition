package com.labelhub.backend.annotation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.annotation.AssignmentAttachmentRepository.AssignmentAttachmentContext;
import com.labelhub.backend.annotation.AssignmentAttachmentRepository.AttachmentFileRecord;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

class AssignmentAttachmentServiceTest {

  private AssignmentAttachmentRepository repository;
  private AssignmentAttachmentProperties properties;
  private AssignmentAttachmentService service;

  @TempDir
  Path tempDir;

  @BeforeEach
  void setUp() {
    repository = mock(AssignmentAttachmentRepository.class);
    properties = mock(AssignmentAttachmentProperties.class);
    when(properties.getStorageDir()).thenReturn(tempDir.toString());
    service = new AssignmentAttachmentService(repository, properties, new ObjectMapper());
  }

  @Test
  void uploadShouldStoreFileAndCreateAttachmentMapping() throws Exception {
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(fileUploadSchema(), 7L)));
    when(repository.createFile(eq(7L), any(), eq("example.png"), eq("image/png"), eq(5L), any()))
        .thenReturn(301L);

    AssignmentAttachmentResponse response = service.upload(
        auth(7L, "labeler"),
        101L,
        "evidence",
        new MockMultipartFile("file", "example.png", "image/png", "hello".getBytes()));

    assertThat(response.fileId()).isEqualTo("301");
    assertThat(response.name()).isEqualTo("example.png");
    assertThat(response.mimeType()).isEqualTo("image/png");
    assertThat(response.size()).isEqualTo(5L);
    assertThat(response.checksum()).isNotBlank();

    ArgumentCaptor<String> storageKey = ArgumentCaptor.forClass(String.class);
    verify(repository).createFile(eq(7L), storageKey.capture(), eq("example.png"), eq("image/png"), eq(5L), any());
    assertThat(Files.readString(tempDir.resolve(storageKey.getValue()))).isEqualTo("hello");
    verify(repository).createAssignmentAttachment(101L, "evidence", 301L, 7L);
  }

  @Test
  void uploadShouldRejectOversizedFile() {
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(fileUploadSchema(), 7L)));

    byte[] oversized = new byte[(int) AssignmentAttachmentService.MAX_FILE_SIZE_BYTES + 1];
    MockMultipartFile file = new MockMultipartFile("file", "large.pdf", "application/pdf", oversized);

    assertThatThrownBy(() -> service.upload(auth(7L, "labeler"), 101L, "evidence", file))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("ATTACHMENT_TOO_LARGE");
    verify(repository, never()).createFile(anyLong(), any(), any(), any(), any(), any());
  }

  @Test
  void uploadShouldRejectDangerousFileType() {
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(fileUploadSchema(), 7L)));
    MockMultipartFile file = new MockMultipartFile("file", "run.exe", "application/octet-stream", "bad".getBytes());

    assertThatThrownBy(() -> service.upload(auth(7L, "labeler"), 101L, "evidence", file))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("UNSUPPORTED_ATTACHMENT_TYPE");
    verify(repository, never()).createFile(anyLong(), any(), any(), any(), any(), any());
  }

  @Test
  void uploadShouldRejectNonFileUploadField() {
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(textSchema(), 7L)));
    MockMultipartFile file = new MockMultipartFile("file", "note.txt", "text/plain", "text".getBytes());

    assertThatThrownBy(() -> service.upload(auth(7L, "labeler"), 101L, "evidence", file))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("INVALID_ATTACHMENT_FIELD");
    verify(repository, never()).createFile(anyLong(), any(), any(), any(), any(), any());
  }

  @Test
  void uploadShouldHideAssignmentOwnedByOtherLabeler() {
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(fileUploadSchema(), 8L)));
    MockMultipartFile file = new MockMultipartFile("file", "note.txt", "text/plain", "text".getBytes());

    assertThatThrownBy(() -> service.upload(auth(7L, "labeler"), 101L, "evidence", file))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("ASSIGNMENT_NOT_FOUND");
    verify(repository, never()).createFile(anyLong(), any(), any(), any(), any(), any());
  }

  @Test
  void downloadShouldRejectReviewerWithoutAssignmentAccess() {
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(fileUploadSchema(), 7L)));
    when(repository.canReviewerAccessAssignment(9L, 101L)).thenReturn(false);

    assertThatThrownBy(() -> service.download(auth(9L, "reviewer"), 101L, 301L))
        .isInstanceOf(ApiException.class)
        .extracting("code")
        .isEqualTo("FORBIDDEN");
    verify(repository, never()).findAttachmentFile(anyLong(), anyLong());
  }

  @Test
  void downloadShouldReturnAttachmentFileForOwner() throws Exception {
    Path stored = tempDir.resolve("assignment-101/file.txt");
    Files.createDirectories(stored.getParent());
    Files.writeString(stored, "content");
    when(repository.findAssignmentContext(101L)).thenReturn(Optional.of(contextWithSchema(fileUploadSchema(), 7L)));
    when(repository.findAttachmentFile(101L, 301L)).thenReturn(Optional.of(
        new AttachmentFileRecord(301L, "assignment-101/file.txt", "file.txt", "text/plain", null, "sum")));

    AssignmentAttachmentDownload download = service.download(auth(3L, "owner"), 101L, 301L);

    assertThat(download.path()).isEqualTo(stored.toAbsolutePath().normalize());
    assertThat(download.filename()).isEqualTo("file.txt");
    assertThat(download.mimeType()).isEqualTo("text/plain");
    assertThat(download.size()).isEqualTo(7L);
  }

  private AssignmentAttachmentContext contextWithSchema(String schemaJson, long labelerId) {
    return new AssignmentAttachmentContext(
        101L,
        201L,
        301L,
        labelerId,
        3L,
        "claimed",
        null,
        "published",
        LocalDateTime.now().plusDays(1),
        null,
        401L,
        schemaJson);
  }

  private String fileUploadSchema() {
    return """
        {
          "fields": [
            {
              "kind": "file-upload",
              "fieldName": "evidence",
              "label": "附件"
            }
          ]
        }
        """;
  }

  private String textSchema() {
    return """
        {
          "fields": [
            {
              "kind": "text-single",
              "fieldName": "evidence",
              "label": "说明"
            }
          ]
        }
        """;
  }

  private UsernamePasswordAuthenticationToken auth(long userId, String role) {
    return new UsernamePasswordAuthenticationToken(
        new AuthenticatedUser(userId, role, role, List.of(role), List.of()),
        "token");
  }
}
