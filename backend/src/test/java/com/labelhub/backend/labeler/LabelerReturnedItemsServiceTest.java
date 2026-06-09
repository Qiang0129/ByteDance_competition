package com.labelhub.backend.labeler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.labeler.LabelerReturnedItemsRepository.ReturnedItemRecord;
import com.labelhub.backend.labeler.LabelerReturnedItemsRepository.ReturnedItemTimelineRecord;
import com.labelhub.backend.task.PageResponse;
import java.time.LocalDateTime;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;

class LabelerReturnedItemsServiceTest {

  private LabelerReturnedItemsRepository repository;
  private LabelerReturnedItemsService service;

  @BeforeEach
  void setUp() {
    repository = mock(LabelerReturnedItemsRepository.class);
    service = new LabelerReturnedItemsService(repository, new ObjectMapper());
  }

  @Test
  void returnedItemAfterEscalationShouldDisplayFinalReviewRejected() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 19, 43);
    ReturnedItemRecord record = returnedRecord(1, "return", true, now);
    when(repository.countReturnedItems(7L, "all", "")).thenReturn(1L);
    when(repository.listReturnedItems(7L, "all", "", 20, 0)).thenReturn(List.of(record));
    when(repository.listReviewTimeline(364L)).thenReturn(List.of(
        timelineSubmit(148L, 1, now.minusMinutes(3)),
        timelineAi(148L, 1, "NEED_HUMAN_REVIEW", now.minusMinutes(2)),
        timelineHuman(148L, 1, "escalate", "无法判定", "All Roles Demo", now.minusMinutes(1)),
        timelineHuman(148L, 1, "return", "错误", "Reviewer Demo", now)));

    PageResponse<LabelerReturnedItemResponse> response =
        service.listReturnedItems(authentication(), "all", "", 1, 20);

    LabelerReturnedItemResponse item = response.items().getFirst();
    assertThat(item.reviewStageNo()).isEqualTo(3);
    assertThat(item.reviewStageLabel()).isEqualTo("终审");
    assertThat(item.reviewResultLabel()).isEqualTo("终审驳回");
    assertThat(item.reviewTimeline()).extracting(LabelerReturnedItemTimelineResponse::title)
        .containsSequence("提交", "第 1 轮 AI预审", "初审升级", "终审驳回", "修改中");
  }

  @Test
  void returnedItemShouldMaskReviewerNamesForLabeler() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 19, 43);
    ReturnedItemRecord record = returnedRecord(1, "return", true, now);
    when(repository.countReturnedItems(7L, "all", "")).thenReturn(1L);
    when(repository.listReturnedItems(7L, "all", "", 20, 0)).thenReturn(List.of(record));
    when(repository.listReviewTimeline(364L)).thenReturn(List.of(
        timelineHuman(148L, 1, "escalate", "needs another reviewer", "All Roles Demo", now.minusMinutes(1)),
        timelineHuman(148L, 1, "return", "wrong answer", "Reviewer Demo", now)));

    LabelerReturnedItemResponse item =
        service.listReturnedItems(authentication(), "all", "", 1, 20).items().getFirst();

    assertThat(item.reviewerName()).isEqualTo("Reviewer");
    assertThat(item.reviewTimeline()).extracting(LabelerReturnedItemTimelineResponse::actor)
        .contains("Reviewer")
        .doesNotContain("All Roles Demo", "Reviewer Demo");
  }

  @Test
  void ordinaryFirstRevisionReturnShouldRemainFirstReview() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 16, 21);
    ReturnedItemRecord record = returnedRecord(1, "return", false, now);
    when(repository.countReturnedItems(7L, "all", "")).thenReturn(1L);
    when(repository.listReturnedItems(7L, "all", "", 20, 0)).thenReturn(List.of(record));
    when(repository.listReviewTimeline(364L)).thenReturn(List.of());

    LabelerReturnedItemResponse item =
        service.listReturnedItems(authentication(), "all", "", 1, 20).items().getFirst();

    assertThat(item.reviewStageNo()).isEqualTo(1);
    assertThat(item.reviewStageLabel()).isEqualTo("初审");
    assertThat(item.reviewResultLabel()).isEqualTo("打回");
  }

  @Test
  void ordinarySecondRevisionReturnShouldRemainSecondReview() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 16, 21);
    ReturnedItemRecord record = returnedRecord(2, "return", false, now);
    when(repository.countReturnedItems(7L, "all", "")).thenReturn(1L);
    when(repository.listReturnedItems(7L, "all", "", 20, 0)).thenReturn(List.of(record));
    when(repository.listReviewTimeline(364L)).thenReturn(List.of());

    LabelerReturnedItemResponse item =
        service.listReturnedItems(authentication(), "all", "", 1, 20).items().getFirst();

    assertThat(item.reviewStageNo()).isEqualTo(2);
    assertThat(item.reviewStageLabel()).isEqualTo("复审");
    assertThat(item.reviewResultLabel()).isEqualTo("打回");
  }

  @Test
  void returnedItemsShouldPassTrimmedKeywordToRepository() {
    when(repository.countReturnedItems(7L, "human_return", "223")).thenReturn(0L);
    when(repository.listReturnedItems(7L, "human_return", "223", 20, 0)).thenReturn(List.of());

    service.listReturnedItems(authentication(), "human_return", " 223 ", 1, 20);

    verify(repository).countReturnedItems(7L, "human_return", "223");
    verify(repository).listReturnedItems(7L, "human_return", "223", 20, 0);
  }

  @Test
  void returnedItemShouldBeLockedWhenTaskDeadlineExpired() {
    LocalDateTime now = LocalDateTime.now();
    ReturnedItemRecord record = returnedRecord(1, "return", false, now, now.minusMinutes(1));
    when(repository.countReturnedItems(7L, "all", "")).thenReturn(1L);
    when(repository.listReturnedItems(7L, "all", "", 20, 0)).thenReturn(List.of(record));
    when(repository.listReviewTimeline(364L)).thenReturn(List.of());

    LabelerReturnedItemResponse item =
        service.listReturnedItems(authentication(), "all", "", 1, 20).items().getFirst();

    assertThat(item.editable()).isFalse();
    assertThat(item.expiredReason()).isEqualTo("TASK_EXPIRED");
    assertThat(item.actionText()).isEqualTo("任务已截止");
  }

  private UsernamePasswordAuthenticationToken authentication() {
    return new UsernamePasswordAuthenticationToken(
        new AuthenticatedUser(7L, "labeler", "Labeler Demo", List.of("labeler"), List.of()),
        "token");
  }

  private ReturnedItemRecord returnedRecord(
      int revisionNo,
      String reviewDecision,
      boolean reviewAfterEscalate,
      LocalDateTime reviewedAt) {
    return returnedRecord(revisionNo, reviewDecision, reviewAfterEscalate, reviewedAt, reviewedAt.plusDays(10));
  }

  private ReturnedItemRecord returnedRecord(
      int revisionNo,
      String reviewDecision,
      boolean reviewAfterEscalate,
      LocalDateTime reviewedAt,
      LocalDateTime taskDeadline) {
    return new ReturnedItemRecord(
        "HUMAN_REVIEW_RETURN",
        364L,
        148L,
        28L,
        223L,
        reviewedAt.plusDays(2),
        taskDeadline,
        "测试文件物料",
        "QA Quality",
        3L,
        revisionNo,
        reviewedAt,
        "Reviewer Demo",
        reviewAfterEscalate ? 2 : 1,
        "错误",
        "NEED_HUMAN_REVIEW",
        "AI 需要人工确认",
        66.0,
        "[]",
        "[]",
        1,
        "RETURNED",
        reviewDecision,
        "错误",
        reviewedAt,
        null,
        1,
        reviewAfterEscalate);
  }

  private ReturnedItemTimelineRecord timelineSubmit(long annotationId, int revisionNo, LocalDateTime occurredAt) {
    return new ReturnedItemTimelineRecord(
        annotationId,
        revisionNo,
        "submit",
        occurredAt,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null);
  }

  private ReturnedItemTimelineRecord timelineAi(
      long annotationId,
      int revisionNo,
      String decision,
      LocalDateTime occurredAt) {
    return new ReturnedItemTimelineRecord(
        annotationId,
        revisionNo,
        "ai_review",
        null,
        occurredAt,
        decision,
        66.0,
        "AI 需要人工确认",
        null,
        null,
        null,
        null);
  }

  private ReturnedItemTimelineRecord timelineHuman(
      long annotationId,
      int revisionNo,
      String decision,
      String reason,
      String reviewerName,
      LocalDateTime occurredAt) {
    return new ReturnedItemTimelineRecord(
        annotationId,
        revisionNo,
        "human_review",
        null,
        null,
        null,
        null,
        null,
        decision,
        reason,
        occurredAt,
        reviewerName);
  }
}
