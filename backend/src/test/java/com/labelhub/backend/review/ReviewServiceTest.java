package com.labelhub.backend.review;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class ReviewServiceTest {

  private final ReviewService service = new ReviewService(null, null, null, null);

  @Test
  void resubmitDeadlineShouldUseTaskDeadlineWhenTaskEndsBeforeDefaultWindow() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 19, 43);
    LocalDateTime taskDeadline = now.plusHours(3);

    LocalDateTime result = service.resolveResubmitDeadline(now, taskDeadline);

    assertThat(result).isEqualTo(taskDeadline);
  }

  @Test
  void resubmitDeadlineShouldUseDefaultWindowWhenTaskDeadlineIsLater() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 19, 43);

    LocalDateTime result = service.resolveResubmitDeadline(now, now.plusDays(3));

    assertThat(result).isEqualTo(now.plusHours(48));
  }

  @Test
  void resubmitDeadlineShouldUseDefaultWindowWhenTaskHasNoDeadline() {
    LocalDateTime now = LocalDateTime.of(2026, 6, 8, 19, 43);

    LocalDateTime result = service.resolveResubmitDeadline(now, null);

    assertThat(result).isEqualTo(now.plusHours(48));
  }
}
