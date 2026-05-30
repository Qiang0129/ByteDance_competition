package com.labelhub.backend.review;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/reviewer")
public class ReviewController {

  private final ReviewService reviewService;

  public ReviewController(ReviewService reviewService) {
    this.reviewService = reviewService;
  }

  @GetMapping("/overview")
  public ReviewerOverviewResponse getOverview(
      Authentication authentication,
      @RequestParam(required = false) Integer days) {
    return reviewService.getOverview(authentication, days);
  }

  @GetMapping("/batches")
  public ReviewerPageResponse<ReviewBatchResponse> listBatches(
      Authentication authentication,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return reviewService.listBatches(authentication, status, keyword, page, pageSize);
  }

  @PostMapping("/batches/{batchId}/claim")
  public ReviewBatchResponse claimBatch(
      Authentication authentication,
      @PathVariable long batchId) {
    return reviewService.claimBatch(authentication, batchId);
  }

  @GetMapping("/batches/{batchId}/annotations")
  public ReviewerPageResponse<AnnotationToReviewResponse> listAnnotations(
      Authentication authentication,
      @PathVariable String batchId,
      @RequestParam(required = false) String decision,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return reviewService.listAnnotations(authentication, batchId, decision, page, pageSize);
  }

  @GetMapping("/ai-review/tasks")
  public ReviewerPageResponse<AiReviewTaskSummaryResponse> listAiReviewTasks(
      Authentication authentication,
      @RequestParam(required = false) String decision,
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return reviewService.listAiReviewTasks(authentication, decision, keyword, page, pageSize);
  }

  @GetMapping("/ai-review/tasks/{taskId}/annotations")
  public ReviewerPageResponse<AnnotationToReviewResponse> listAiReviewAnnotations(
      Authentication authentication,
      @PathVariable long taskId,
      @RequestParam(required = false) String decision,
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return reviewService.listAiReviewAnnotations(authentication, taskId, decision, keyword, page, pageSize);
  }

  @PostMapping("/annotations/{annotationId}/decision")
  public AnnotationToReviewResponse submitDecision(
      Authentication authentication,
      @PathVariable long annotationId,
      @RequestBody(required = false) ReviewDecisionRequest request) {
    return reviewService.submitDecision(authentication, annotationId, request);
  }

  @GetMapping("/disputes")
  public ReviewerPageResponse<DisputeItemResponse> listDisputes(
      Authentication authentication,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return reviewService.listDisputes(authentication, status, page, pageSize);
  }

  @PostMapping("/disputes/{disputeId}/resolve")
  public DisputeItemResponse resolveDispute(
      Authentication authentication,
      @PathVariable long disputeId,
      @RequestBody(required = false) ResolveDisputeRequest request) {
    return reviewService.resolveDispute(authentication, disputeId, request);
  }
}
