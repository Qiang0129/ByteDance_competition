package com.labelhub.backend.ai;

import com.labelhub.backend.task.PageResponse;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai-review")
public class AiReviewController {

  private final AiReviewService aiReviewService;

  public AiReviewController(AiReviewService aiReviewService) {
    this.aiReviewService = aiReviewService;
  }

  @GetMapping("/rules")
  public PageResponse<AiReviewRuleResponse> listRules(
      Authentication authentication,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String taskId,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return aiReviewService.listRules(authentication, status, taskId, page, pageSize);
  }

  @PostMapping("/rules")
  public AiReviewRuleResponse createRule(
      Authentication authentication,
      @Valid @RequestBody AiReviewRuleRequest request) {
    return aiReviewService.createRule(authentication, request);
  }

  @GetMapping("/rules/{ruleId}")
  public AiReviewRuleResponse getRule(Authentication authentication, @PathVariable long ruleId) {
    return aiReviewService.getRule(authentication, ruleId);
  }

  @PutMapping("/rules/{ruleId}")
  public AiReviewRuleResponse updateRule(
      Authentication authentication,
      @PathVariable long ruleId,
      @Valid @RequestBody AiReviewRuleRequest request) {
    return aiReviewService.updateRule(authentication, ruleId, request);
  }

  @DeleteMapping("/rules/{ruleId}")
  public void deleteRule(Authentication authentication, @PathVariable long ruleId) {
    aiReviewService.deleteRule(authentication, ruleId);
  }

  @PostMapping("/rules/{ruleId}/toggle")
  public AiReviewRuleResponse toggleRule(
      Authentication authentication,
      @PathVariable long ruleId,
      @RequestBody(required = false) ToggleAiReviewRuleRequest request) {
    return aiReviewService.toggleRule(authentication, ruleId, request);
  }

  @GetMapping("/jobs")
  public PageResponse<AiReviewJobResponse> listJobs(
      Authentication authentication,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String ruleId,
      @RequestParam(required = false) String taskId,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return aiReviewService.listJobs(authentication, status, ruleId, taskId, page, pageSize);
  }

  @PostMapping("/jobs/claim-next")
  public AiReviewJobClaimResponse claimNext(Authentication authentication) {
    return aiReviewService.claimNext(authentication);
  }

  @PostMapping("/jobs/{jobId}/complete")
  public AiReviewJobResponse complete(
      Authentication authentication,
      @PathVariable long jobId,
      @RequestBody(required = false) AiReviewCompleteRequest request) {
    return aiReviewService.complete(authentication, jobId, request);
  }

  @PostMapping("/jobs/{jobId}/fail")
  public AiReviewJobResponse fail(
      Authentication authentication,
      @PathVariable long jobId,
      @RequestBody(required = false) AiReviewFailRequest request) {
    return aiReviewService.fail(authentication, jobId, request);
  }

  @PostMapping("/jobs/{jobId}/cancel")
  public AiReviewJobResponse cancel(
      Authentication authentication,
      @PathVariable long jobId,
      @RequestBody(required = false) AiReviewCancelRequest request) {
    return aiReviewService.cancel(authentication, jobId, request);
  }

  @PostMapping("/jobs/{jobId}/retry")
  public AiReviewJobResponse retry(Authentication authentication, @PathVariable long jobId) {
    return aiReviewService.retry(authentication, jobId);
  }

  @PostMapping("/jobs/batch-delete")
  public AiReviewBatchDeleteResponse batchDeleteJobs(
      Authentication authentication,
      @RequestBody AiReviewBatchDeleteRequest request) {
    return aiReviewService.batchDeleteJobs(authentication, request);
  }

  @GetMapping("/results/{annotationId}")
  public AiReviewResultResponse getResult(
      Authentication authentication,
      @PathVariable long annotationId) {
    return aiReviewService.getResult(authentication, annotationId);
  }
}
