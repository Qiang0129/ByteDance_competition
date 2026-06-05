package com.labelhub.backend.dashboard;

import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

  private final DashboardService dashboardService;

  public DashboardController(DashboardService dashboardService) {
    this.dashboardService = dashboardService;
  }

  @GetMapping("/overview")
  public DashboardOverviewResponse getOverview(
      Authentication authentication,
      @RequestParam(required = false) String range) {
    return dashboardService.getOverview(authentication, range);
  }

  @GetMapping("/task-progress")
  public DashboardItemsResponse<TaskProgressResponse> getTaskProgress(Authentication authentication) {
    return dashboardService.getTaskProgress(authentication);
  }

  @GetMapping("/review-distribution")
  public ReviewDistributionResponse getReviewDistribution(
      Authentication authentication,
      @RequestParam(required = false) String range,
      @RequestParam(required = false) Integer year) {
    return dashboardService.getReviewDistribution(authentication, range, year);
  }

  @GetMapping("/review-distribution/report")
  public ResponseEntity<Resource> downloadReviewDistributionReport(
      Authentication authentication,
      @RequestParam(required = false) Integer year) {
    return dashboardService.downloadReviewDistributionReport(authentication, year);
  }

  @GetMapping("/labeler-performance")
  public DashboardItemsResponse<LabelerPerformanceResponse> getLabelerPerformance(
      Authentication authentication,
      @RequestParam(required = false) String range) {
    return dashboardService.getLabelerPerformance(authentication, range);
  }

  @GetMapping("/submission-timeline")
  public DashboardItemsResponse<SubmissionTimelineMonthResponse> getSubmissionTimeline(
      Authentication authentication,
      @RequestParam(required = false) Integer year) {
    return dashboardService.getSubmissionTimeline(authentication, year);
  }

  @GetMapping("/role-breakdown")
  public DashboardItemsResponse<RoleBreakdownResponse> getRoleBreakdown(Authentication authentication) {
    return dashboardService.getRoleBreakdown(authentication);
  }

  @GetMapping("/disputes")
  public DisputeStatsResponse getDisputes(
      Authentication authentication,
      @RequestParam(required = false) Integer days) {
    return dashboardService.getDisputes(authentication, days);
  }
}
