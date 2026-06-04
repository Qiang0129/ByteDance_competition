package com.labelhub.backend.dashboard;

import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import com.labelhub.backend.dashboard.DashboardIssueFeedbackRepository.IssueFeedbackRecord;
import com.labelhub.backend.task.PageResponse;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

@Service
public class DashboardIssueFeedbackService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final DashboardIssueFeedbackRepository repository;

  public DashboardIssueFeedbackService(DashboardIssueFeedbackRepository repository) {
    this.repository = repository;
  }

  public PageResponse<IssueFeedbackResponse> listIssueFeedback(
      Authentication authentication,
      String status,
      Integer page,
      Integer pageSize) {
    AuthenticatedUser owner = requireOwner(authentication);
    String normalizedStatus = normalizeStatus(status);
    int safePage = page == null || page < 1 ? 1 : page;
    int safePageSize = pageSize == null || pageSize < 1 ? 20 : Math.min(pageSize, 100);
    long total = repository.countIssueFeedback(owner.id(), normalizedStatus);
    List<IssueFeedbackResponse> items = repository
        .listIssueFeedback(owner.id(), normalizedStatus, safePageSize, (safePage - 1) * safePageSize)
        .stream()
        .map(this::toResponse)
        .toList();
    return new PageResponse<>(items, safePage, safePageSize, total);
  }

  public MarkIssueFeedbackViewedResponse markIssueFeedbackViewed(
      Authentication authentication,
      MarkIssueFeedbackViewedRequest request) {
    AuthenticatedUser owner = requireOwner(authentication);
    List<Long> issueIds = normalizeIssueIds(request == null ? null : request.issueIds());
    if (issueIds.isEmpty()) {
      return new MarkIssueFeedbackViewedResponse(0);
    }
    int markedCount = repository.markIssueFeedbackViewed(owner.id(), issueIds);
    return new MarkIssueFeedbackViewedResponse(markedCount);
  }

  private String normalizeStatus(String status) {
    if (status == null || status.isBlank()) {
      return "open";
    }
    String normalized = status.trim().toLowerCase(Locale.ROOT);
    if (List.of("open", "viewed", "all").contains(normalized)) {
      return normalized;
    }
    throw new ApiException(
        HttpStatus.BAD_REQUEST,
        "INVALID_ISSUE_STATUS",
        "unsupported issue status");
  }

  private List<Long> normalizeIssueIds(List<String> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) {
      return List.of();
    }
    Set<Long> normalizedIds = new LinkedHashSet<>();
    for (String rawId : issueIds) {
      if (rawId == null || rawId.isBlank()) {
        continue;
      }
      try {
        long issueId = Long.parseLong(rawId.trim());
        if (issueId > 0) {
          normalizedIds.add(issueId);
        }
      } catch (NumberFormatException ex) {
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "INVALID_ISSUE_ID",
            "issue id must be a positive integer");
      }
    }
    return List.copyOf(normalizedIds);
  }

  private IssueFeedbackResponse toResponse(IssueFeedbackRecord record) {
    return new IssueFeedbackResponse(
        Long.toString(record.issueId()),
        Long.toString(record.assignmentId()),
        Long.toString(record.taskId()),
        blankToDefault(record.taskTitle(), "标注任务"),
        displayItemNo(record),
        Long.toString(record.labelerId()),
        blankToDefault(record.labelerName(), "Labeler"),
        record.category(),
        categoryLabel(record.category()),
        record.description(),
        record.status(),
        formatDateTime(record.createdAt()));
  }

  private String categoryLabel(String category) {
    return switch (category == null ? "" : category) {
      case "data_error" -> "数据错误";
      case "schema_mismatch" -> "模板不匹配";
      case "media_broken" -> "资源加载失败";
      case "duplicate" -> "题目重复";
      case "sensitive" -> "敏感内容";
      case "other" -> "其它";
      default -> "未分类";
    };
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private String blankToDefault(String value, String fallback) {
    return value == null || value.isBlank() ? fallback : value;
  }

  private String displayItemNo(IssueFeedbackRecord record) {
    return Long.toString(record.taskItemPositionNo() == null ? record.itemId() : record.taskItemPositionNo());
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
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
