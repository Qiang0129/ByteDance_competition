package com.labelhub.backend.dashboard;

import com.labelhub.backend.task.PageResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/dashboard")
public class DashboardIssueFeedbackController {

  private final DashboardIssueFeedbackService issueFeedbackService;

  public DashboardIssueFeedbackController(DashboardIssueFeedbackService issueFeedbackService) {
    this.issueFeedbackService = issueFeedbackService;
  }

  @GetMapping("/issue-feedback")
  public PageResponse<IssueFeedbackResponse> listIssueFeedback(
      Authentication authentication,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return issueFeedbackService.listIssueFeedback(authentication, status, page, pageSize);
  }
}
