package com.labelhub.backend.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

class ExportServiceTest {

  private ExportService exportService;
  private ExportRepository exportRepository;
  private ExportProperties exportProperties;

  @TempDir
  Path tempDir;

  @BeforeEach
  void setUp() {
    exportRepository = mock(ExportRepository.class);
    exportProperties = mock(ExportProperties.class);
    exportService = new ExportService(
        exportRepository,
        mock(com.labelhub.backend.workflow.StateMachineService.class),
        new ObjectMapper(),
        exportProperties);
  }

  @AfterEach
  void tearDown() {
    exportService = null;
  }

  @Test
  void contentMarkdownShouldFallbackToRawPayloadPrompt() {
    ExportRepository.ExportRowRecord row = new ExportRepository.ExportRowRecord(
        18L,
        "测试agent",
        111L,
        "accepted",
        251L,
        193L,
        1,
        "张三",
        null,
        null,
        null,
        null,
        null,
        null,
        LocalDateTime.now(),
        LocalDateTime.now(),
        "{\"prompt\":\"题面来自原始数据\"}",
        "",
        "text",
        "",
        "{\"quality_result\":\"option_a\"}",
        null);

    Object value = invokeSystemValue(row, "contentMarkdown");

    assertThat(value).isEqualTo("题面来自原始数据");
  }

  @Test
  void contentMarkdownShouldPreferItemContentMarkdown() {
    ExportRepository.ExportRowRecord row = new ExportRepository.ExportRowRecord(
        18L,
        "测试agent",
        111L,
        "accepted",
        251L,
        193L,
        1,
        "张三",
        null,
        null,
        null,
        null,
        null,
        null,
        LocalDateTime.now(),
        LocalDateTime.now(),
        "{\"prompt\":\"题面来自原始数据\"}",
        "### 富文本题面",
        "markdown",
        "",
        "{\"quality_result\":\"option_a\"}",
        null);

    Object value = invokeSystemValue(row, "contentMarkdown");

    assertThat(value).isEqualTo("### 富文本题面");
  }

  @Test
  void defaultFieldOptionsShouldUseChineseLabelsForSystemIdentifiers() {
    List<ExportFieldOptionResponse> options = invokeDefaultFieldOptions();

    assertThat(options).extracting(ExportFieldOptionResponse::label)
        .containsSequence("任务", "题号", "题目ID", "作业ID", "标注ID");
  }

  @Test
  void downloadShouldNotMarkExportAsDownloaded() throws Exception {
    when(exportProperties.getStorageDir()).thenReturn(tempDir.toString());
    Path file = tempDir.resolve("owner-1/export-1.json");
    Files.createDirectories(file.getParent());
    Files.writeString(file, "{\"ok\":true}");

    ExportRepository.ExportJobRecord job = exportJobRecord(null);
    when(exportRepository.findOwnerExportJob(1L, 1L)).thenReturn(Optional.of(job));

    ResponseEntity<?> response = exportService.download(authentication(), 1L);

    assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
    verify(exportRepository, never()).markDownloaded(anyLong());
  }

  @Test
  void confirmDownloadShouldMarkExportAsDownloaded() throws Exception {
    when(exportProperties.getStorageDir()).thenReturn(tempDir.toString());
    Path file = tempDir.resolve("owner-1/export-1.json");
    Files.createDirectories(file.getParent());
    Files.writeString(file, "{\"ok\":true}");

    ExportRepository.ExportJobRecord jobBefore = exportJobRecord(null);
    ExportRepository.ExportJobRecord jobAfter = exportJobRecord(LocalDateTime.now());
    when(exportRepository.lockOwnerExportJob(1L, 1L)).thenReturn(Optional.of(jobBefore));
    when(exportRepository.findOwnerExportJob(1L, 1L)).thenReturn(Optional.of(jobAfter));

    ExportJobResponse response = exportService.confirmDownload(authentication(), 1L);

    assertThat(response.downloadedAt()).isNotBlank();
    verify(exportRepository).markDownloaded(1L);
  }

  private Object invokeSystemValue(ExportRepository.ExportRowRecord row, String path) {
    try {
      Method method = ExportService.class.getDeclaredMethod(
          "systemValue",
          ExportRepository.ExportRowRecord.class,
          String.class);
      method.setAccessible(true);
      return method.invoke(exportService, row, path);
    } catch (ReflectiveOperationException exception) {
      throw new AssertionError("failed to invoke systemValue", exception);
    }
  }

  @SuppressWarnings("unchecked")
  private List<ExportFieldOptionResponse> invokeDefaultFieldOptions() {
    try {
      Method method = ExportService.class.getDeclaredMethod(
          "defaultFieldOptions",
          long.class,
          List.class);
      method.setAccessible(true);
      return (List<ExportFieldOptionResponse>) method.invoke(exportService, 18L, List.of());
    } catch (ReflectiveOperationException exception) {
      throw new AssertionError("failed to invoke defaultFieldOptions", exception);
    }
  }

  private UsernamePasswordAuthenticationToken authentication() {
    return new UsernamePasswordAuthenticationToken(
        new AuthenticatedUser(1L, "owner", "Owner", List.of("owner"), List.of()),
        "token");
  }

  private ExportRepository.ExportJobRecord exportJobRecord(LocalDateTime downloadedAt) {
    LocalDateTime now = LocalDateTime.of(2026, 6, 2, 12, 0);
    return new ExportRepository.ExportJobRecord(
        1L,
        1L,
        "测试任务",
        "json",
        "succeeded",
        100,
        1L,
        10,
        null,
        "{}",
        now,
        now,
        downloadedAt,
        now,
        now,
        "owner",
        "owner-1/export-1.json",
        "export-1.json",
        "application/json",
        11L);
  }
}
