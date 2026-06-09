package com.labelhub.backend.dashboard;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
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
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DashboardServiceTest {

  @Mock
  private DashboardRepository repository;

  @Mock
  private DashboardIssueFeedbackRepository issueFeedbackRepository;

  @Mock
  private TaskDeadlineSettlementService settlementService;

  private DashboardService service;

  @BeforeEach
  void setUp() {
    service = new DashboardService(repository, issueFeedbackRepository, settlementService);
  }

  @Test
  void ownerCanDownloadDashboardExportCsv() throws Exception {
    when(repository.countActiveTasks(1L)).thenReturn(2L);
    when(repository.countActiveUsersByRole("labeler")).thenReturn(4L);
    when(repository.countActiveUsersByRole("reviewer")).thenReturn(3L);
    when(repository.countPendingReview(1L)).thenReturn(18L);
    when(repository.countAiDecisions(eq(1L), any(), any()))
        .thenReturn(new DashboardRepository.AiDecisionCounts(10, 2, 1, 13));
    when(repository.averageDurationSec(eq(1L), any(), any())).thenReturn(120L);
    when(repository.countHumanDecisions(eq(1L), any(), any()))
        .thenReturn(new DashboardRepository.HumanDecisionCounts(8, 3));
    when(repository.getDisputeStats(eq(1L), any(), any()))
        .thenReturn(new DashboardRepository.DisputeStatsRecord(2, 1, 0.5D, 0.8D));
    when(repository.listTaskProgress(1L, 12))
        .thenReturn(List.of(new DashboardRepository.TaskProgressRecord(28L, "测试文件物料", 12, 7, 2)));
    when(repository.listTaskMilestones(1L, 4))
        .thenReturn(List.of(new DashboardRepository.TaskMilestoneRecord(
            28L,
            "测试文件物料",
            "ended",
            LocalDateTime.of(2026, 6, 10, 19, 43),
            12,
            7,
            2,
            "completed")));
    when(repository.listDeadlineAlerts(1L, 4))
        .thenReturn(List.of(new DashboardRepository.DeadlineAlertRecord(
            28L,
            "测试文件物料",
            LocalDateTime.of(2026, 6, 10, 19, 43),
            3,
            12)));
    when(repository.listLabelerPerformance(eq(1L), any(), any(), eq(10)))
        .thenReturn(List.of(new DashboardRepository.LabelerPerformanceRecord(
            7L,
            "Labeler Demo",
            "通用标注",
            10,
            8,
            2,
            90)));
    when(repository.listSubmissionTimeline(eq(1L), anyInt()))
        .thenReturn(List.of(new DashboardRepository.SubmissionTimelineRecord(6, 8, 1, 0)));
    when(repository.listRoleBreakdown(1L))
        .thenReturn(List.of(new DashboardRepository.RoleBreakdownRecord("文本", 4)));
    when(issueFeedbackRepository.countIssueFeedback(1L, "open")).thenReturn(5L);

    ResponseEntity<Resource> response = service.downloadDashboardExport(ownerAuth(), "7d", 2026);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
        .contains("dashboard-export-7d-2026.csv");
    String csv = new String(response.getBody().getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertThat(csv).contains("LabelHub 数据看板导出");
    assertThat(csv).contains("导出范围,近 7 日");
    assertThat(csv).contains("任务进度");
    assertThat(csv).contains("审核分布");
    assertThat(csv).contains("题目反馈待查看,5");
    assertThat(csv).contains("测试文件物料");
    assertThat(csv).contains("Labeler Demo,通用标注,10,8,2,80.00%,90,80.00%");
    verify(settlementService).settleExpiredTasks();
  }

  @Test
  void ownerGetsLabelerPerformanceDetails() {
    when(repository.listLabelerPerformance(eq(1L), any(), any(), eq(10)))
        .thenReturn(List.of(new DashboardRepository.LabelerPerformanceRecord(
            7L,
            "Labeler Demo",
            "QA Quality",
            10,
            8,
            2,
            90)));

    DashboardItemsResponse<LabelerPerformanceResponse> response =
        service.getLabelerPerformance(ownerAuth(), "30d");

    assertThat(response.items()).hasSize(1);
    LabelerPerformanceResponse item = response.items().get(0);
    assertThat(item.score()).isEqualTo(0.8D);
    assertThat(item.passRate()).isEqualTo(0.8D);
    assertThat(item.submittedCount()).isEqualTo(10);
    assertThat(item.approvedCount()).isEqualTo(8);
    assertThat(item.returnedCount()).isEqualTo(2);
    assertThat(item.avgDurationSec()).isEqualTo(90);
  }

  @Test
  void nonOwnerCannotDownloadDashboardExport() {
    assertThatThrownBy(() -> service.downloadDashboardExport(labelerAuth(), "30d", 2026))
        .isInstanceOf(ApiException.class)
        .extracting("status")
        .isEqualTo(HttpStatus.FORBIDDEN);
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
