package com.labelhub.backend.ownerreview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.task.TaskDeadlineSettlementService;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

@ExtendWith(MockitoExtension.class)
class OwnerReviewServiceTest {

  @Mock
  private OwnerReviewRepository repository;

  @Mock
  private TaskDeadlineSettlementService settlementService;

  private OwnerReviewService service;

  @BeforeEach
  void setUp() {
    service = new OwnerReviewService(repository, settlementService);
  }

  @Test
  void ownerCanDownloadHumanAuditLogCsv() throws Exception {
    when(repository.taskBelongsToOwner(1L, 28L)).thenReturn(true);
    when(repository.listTaskAuditLogForExport(1L, 28L, true)).thenReturn(List.of(auditLog("reviewer")));

    ResponseEntity<Resource> response = service.downloadTaskAuditLog(ownerAuth(), 28L, "human");

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
        .contains("review-task-28-human-audit-log.csv");
    String csv = new String(response.getBody().getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(csv).contains("日志ID,任务ID,任务标题,题号");
    assertThat(csv).contains("101,28,测试文件物料,3,364,148,223,Labeler Demo,Reviewer Demo,reviewer");
    assertThat(csv).contains("\"原因,错误\"");
    verify(repository).listTaskAuditLogForExport(1L, 28L, true);
    verify(settlementService).settleExpiredTasks();
  }

  @Test
  void ownerCanDownloadFullAuditLogCsv() throws Exception {
    when(repository.taskBelongsToOwner(1L, 28L)).thenReturn(true);
    when(repository.listTaskAuditLogForExport(1L, 28L, false))
        .thenReturn(List.of(auditLog("system_agent")));

    ResponseEntity<Resource> response = service.downloadTaskAuditLog(ownerAuth(), 28L, "full");

    assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
        .contains("review-task-28-full-audit-log.csv");
    String csv = new String(response.getBody().getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(csv).contains("system_agent");
    verify(repository).listTaskAuditLogForExport(1L, 28L, false);
  }

  @Test
  void nonOwnerCannotDownloadTaskAuditLog() {
    assertThatThrownBy(() -> service.downloadTaskAuditLog(labelerAuth(), 28L, "human"))
        .isInstanceOf(ApiException.class)
        .extracting("status")
        .isEqualTo(HttpStatus.FORBIDDEN);
  }

  @Test
  void cannotDownloadOtherOwnerTaskAuditLog() {
    when(repository.taskBelongsToOwner(1L, 28L)).thenReturn(false);

    assertThatThrownBy(() -> service.downloadTaskAuditLog(ownerAuth(), 28L, "human"))
        .isInstanceOf(ApiException.class)
        .extracting("status")
        .isEqualTo(HttpStatus.NOT_FOUND);
  }

  @Test
  void invalidAuditExportScopeIsRejected() {
    when(repository.taskBelongsToOwner(1L, 28L)).thenReturn(true);

    assertThatThrownBy(() -> service.downloadTaskAuditLog(ownerAuth(), 28L, "unknown"))
        .isInstanceOf(ApiException.class)
        .extracting("status")
        .isEqualTo(HttpStatus.BAD_REQUEST);
  }

  private OwnerReviewRepository.AuditLogRecord auditLog(String operatorRole) {
    return new OwnerReviewRepository.AuditLogRecord(
        101L,
        "human_review",
        88L,
        28L,
        "测试文件物料",
        364L,
        148L,
        223L,
        3,
        "Labeler Demo",
        "Reviewer Demo",
        operatorRole,
        "annotation.review.return",
        "reviewing",
        "returned",
        "原因,错误",
        LocalDateTime.of(2026, 6, 8, 19, 43));
  }

  private UsernamePasswordAuthenticationToken ownerAuth() {
    return new UsernamePasswordAuthenticationToken(
        new AuthenticatedUser(1L, "owner", "Owner", List.of("owner"), List.of()),
        null);
  }

  private UsernamePasswordAuthenticationToken labelerAuth() {
    return new UsernamePasswordAuthenticationToken(
        new AuthenticatedUser(7L, "labeler", "Labeler", List.of("labeler"), List.of()),
        null);
  }
}
