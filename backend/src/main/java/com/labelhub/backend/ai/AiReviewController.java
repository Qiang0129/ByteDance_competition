package com.labelhub.backend.ai;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai-review/jobs")
public class AiReviewController {

  private final AiReviewService aiReviewService;

  public AiReviewController(AiReviewService aiReviewService) {
    this.aiReviewService = aiReviewService;
  }

  @PostMapping("/claim-next")
  public AiReviewJobResponse claimNext(Authentication authentication) {
    return aiReviewService.claimNext(authentication);
  }

  @PostMapping("/{jobId}/complete")
  public AiReviewJobResponse complete(
      Authentication authentication,
      @PathVariable long jobId,
      @RequestBody(required = false) AiReviewCompleteRequest request) {
    return aiReviewService.complete(authentication, jobId, request);
  }

  @PostMapping("/{jobId}/fail")
  public AiReviewJobResponse fail(
      Authentication authentication,
      @PathVariable long jobId,
      @RequestBody(required = false) AiReviewFailRequest request) {
    return aiReviewService.fail(authentication, jobId, request);
  }

  @PostMapping("/{jobId}/retry")
  public AiReviewJobResponse retry(Authentication authentication, @PathVariable long jobId) {
    return aiReviewService.retry(authentication, jobId);
  }
}
