package com.labelhub.backend.ownerreview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

@ExtendWith(MockitoExtension.class)
class OwnerReviewRepositoryTest {

  @Mock
  private JdbcTemplate jdbcTemplate;

  private OwnerReviewRepository repository;

  @BeforeEach
  void setUp() {
    repository = new OwnerReviewRepository(jdbcTemplate);
  }

  @Test
  void taskAnnotationsUseTaskGlobalItemIndex() {
    repository.listTaskAnnotations(1L, 28L, null, 20, 0);

    ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
    verify(jdbcTemplate).query(
        sqlCaptor.capture(),
        org.mockito.ArgumentMatchers.<RowMapper<OwnerReviewRepository.AnnotationRecord>>any(),
        eq(1L),
        eq(28L),
        eq(20),
        eq(0));

    String sql = sqlCaptor.getValue();
    assertThat(sql)
        .contains("FROM task_items ti")
        .contains("ti.position_no")
        .contains("ti.task_id = a.task_id")
        .contains("ti.item_id = a.item_id")
        .contains("ORDER BY annotation_rows.item_index ASC, annotation_rows.labeler_name ASC, annotation_rows.annotation_id ASC");
    assertThat(sql)
        .doesNotContain("ranked.labeler_id = a.labeler_id")
        .doesNotContain("ranked.id <= a.id");
  }

  @Test
  void auditLogUsesTaskGlobalItemIndex() {
    repository.listTaskAuditLogForExport(1L, 28L, false);

    ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
    verify(jdbcTemplate).query(
        sqlCaptor.capture(),
        org.mockito.ArgumentMatchers.<RowMapper<OwnerReviewRepository.AuditLogRecord>>any(),
        eq(1L),
        eq(28L));

    String sql = sqlCaptor.getValue();
    assertThat(sql)
        .contains("FROM task_items ti")
        .contains("ti.position_no")
        .contains("ti.task_id = context_assignment.task_id")
        .contains("ti.item_id = context_assignment.item_id");
    assertThat(sql)
        .doesNotContain("ranked.labeler_id = context_assignment.labeler_id")
        .doesNotContain("ranked.id <= context_assignment.id");
  }
}
