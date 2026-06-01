package com.labelhub.backend.annotation;

import com.fasterxml.jackson.databind.node.NullNode;
import com.labelhub.backend.task.PageResponse;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class AnnotationController {

  private final AnnotationService annotationService;
  private final LabelerAssistantService labelerAssistantService;

  public AnnotationController(
      AnnotationService annotationService,
      LabelerAssistantService labelerAssistantService) {
    this.annotationService = annotationService;
    this.labelerAssistantService = labelerAssistantService;
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

  @GetMapping("/labeler/drafts")
  public PageResponse<LabelerDraftResponse> listDrafts(
      Authentication authentication,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return annotationService.listDrafts(authentication, page, pageSize);
  }

  @DeleteMapping("/assignments/{assignmentId}/draft")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteDraft(
      Authentication authentication,
      @PathVariable long assignmentId) {
    annotationService.deleteDraft(authentication, assignmentId);
  }

  @PostMapping("/assignments/{assignmentId}/submit")
  public AnnotationResponse submit(
      Authentication authentication,
      @PathVariable long assignmentId,
      @RequestBody(required = false) SubmitAnnotationRequest request) {
    return annotationService.submit(authentication, assignmentId, request);
  }

  @PostMapping("/tasks/{taskId}/assignments/submit")
  public BatchSubmitResponse submitTaskAssignments(
      Authentication authentication,
      @PathVariable long taskId) {
    return annotationService.submitTaskAssignments(authentication, taskId);
  }

  @PostMapping("/assignments/{assignmentId}/issues")
  public ReportIssueResponse reportIssue(
      Authentication authentication,
      @PathVariable long assignmentId,
      @RequestBody(required = false) ReportIssueRequest request) {
    return annotationService.reportIssue(authentication, assignmentId, request);
  }

  @PostMapping("/labeler/assignments/{assignmentId}/assistant")
  public AssistantAskResponse askAssistant(
      Authentication authentication,
      @PathVariable long assignmentId,
      @RequestBody(required = false) AssistantAskRequest request) {
    return labelerAssistantService.ask(authentication, assignmentId, request);
  }
}
