package com.labelhub.backend.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Method;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ExportServiceTest {

  private ExportService exportService;

  @BeforeEach
  void setUp() {
    exportService = new ExportService(
        mock(ExportRepository.class),
        mock(com.labelhub.backend.workflow.StateMachineService.class),
        new ObjectMapper(),
        mock(ExportProperties.class));
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
}
