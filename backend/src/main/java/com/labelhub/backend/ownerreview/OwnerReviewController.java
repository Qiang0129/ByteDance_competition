package com.labelhub.backend.ownerreview;

import com.labelhub.backend.task.PageResponse;
import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reviews")
public class OwnerReviewController {

  private final OwnerReviewService ownerReviewService;

  public OwnerReviewController(OwnerReviewService ownerReviewService) {
    this.ownerReviewService = ownerReviewService;
  }

  @GetMapping("/overview")
  public OwnerReviewOverviewResponse getOverview(
      Authentication authentication,
      @RequestParam(required = false) Integer days) {
    return ownerReviewService.getOverview(authentication, days);
  }

  @GetMapping("/tasks")
  public PageResponse<OwnerReviewTaskResponse> listTasks(
      Authentication authentication,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return ownerReviewService.listTasks(authentication, status, keyword, page, pageSize);
  }

  @GetMapping("/reviewers")
  public List<OwnerReviewReviewerResponse> listReviewers(Authentication authentication) {
    return ownerReviewService.listReviewers(authentication);
  }

  @GetMapping("/tasks/{taskId}/annotations")
  public PageResponse<OwnerReviewAnnotationResponse> listTaskAnnotations(
      Authentication authentication,
      @PathVariable long taskId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return ownerReviewService.listTaskAnnotations(authentication, taskId, status, page, pageSize);
  }

  @GetMapping("/audit-log")
  public PageResponse<OwnerReviewAuditLogEntryResponse> listAuditLog(
      Authentication authentication,
      @RequestParam(required = false) Integer days,
      @RequestParam(required = false) Long taskId,
      @RequestParam(required = false) Long reviewerId,
      @RequestParam(required = false) String operatorRole,
      @RequestParam(required = false) String action,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return ownerReviewService.listAuditLog(
        authentication,
        days,
        taskId,
        reviewerId,
        operatorRole,
        action,
        page,
        pageSize);
  }

  @GetMapping("/audit-log/{logId}/item-timeline")
  public OwnerReviewAuditItemTimelineResponse getAuditLogItemTimeline(
      Authentication authentication,
      @PathVariable long logId) {
    return ownerReviewService.getAuditLogItemTimeline(authentication, logId);
  }
}
