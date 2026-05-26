package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.node.NullNode;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AnnotationController {

  private final AnnotationService annotationService;

  public AnnotationController(AnnotationService annotationService) {
    this.annotationService = annotationService;
  }

  @GetMapping("/assignments/{assignmentId}/item")
  public AssignmentItemResponse getAssignmentItem(
      Authentication authentication,
      @PathVariable long assignmentId) {
    return annotationService.getAssignmentItem(authentication, assignmentId);
  }

  @GetMapping("/assignments/{assignmentId}/draft")
  public Object getDraft(
      Authentication authentication,
      @PathVariable long assignmentId) {
    DraftResponse draft = annotationService.getDraft(authentication, assignmentId);
    return draft == null ? NullNode.getInstance() : draft;
  }

  @PutMapping("/assignments/{assignmentId}/draft")
  public DraftResponse saveDraft(
      Authentication authentication,
      @PathVariable long assignmentId,
      @RequestBody(required = false) DraftRequest request) {
    return annotationService.saveDraft(authentication, assignmentId, request);
  }

  @PostMapping("/assignments/{assignmentId}/submit")
  public AnnotationResponse submit(
      Authentication authentication,
      @PathVariable long assignmentId,
      @RequestBody(required = false) SubmitAnnotationRequest request) {
    return annotationService.submit(authentication, assignmentId, request);
  }
}
