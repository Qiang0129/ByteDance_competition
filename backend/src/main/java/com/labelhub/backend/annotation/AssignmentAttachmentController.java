package com.labelhub.backend.annotation;

import java.nio.charset.StandardCharsets;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class AssignmentAttachmentController {

  private final AssignmentAttachmentService attachmentService;

  public AssignmentAttachmentController(AssignmentAttachmentService attachmentService) {
    this.attachmentService = attachmentService;
  }

  @PostMapping(
      path = "/assignments/{assignmentId}/attachments",
      consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public AssignmentAttachmentResponse uploadAttachment(
      Authentication authentication,
      @PathVariable long assignmentId,
      @RequestParam String fieldName,
      @RequestPart("file") MultipartFile file) {
    return attachmentService.upload(authentication, assignmentId, fieldName, file);
  }

  @GetMapping("/assignments/{assignmentId}/attachments/{fileId}/download")
  public ResponseEntity<Resource> downloadAttachment(
      Authentication authentication,
      @PathVariable long assignmentId,
      @PathVariable long fileId) {
    AssignmentAttachmentDownload download = attachmentService.download(authentication, assignmentId, fileId);
    FileSystemResource resource = new FileSystemResource(download.path());
    return ResponseEntity.ok()
        .contentType(parseMediaType(download.mimeType()))
        .contentLength(download.size())
        .header(
            HttpHeaders.CONTENT_DISPOSITION,
            ContentDisposition.attachment()
                .filename(download.filename(), StandardCharsets.UTF_8)
                .build()
                .toString())
        .body(resource);
  }

  private MediaType parseMediaType(String mimeType) {
    try {
      return mimeType == null || mimeType.isBlank()
          ? MediaType.APPLICATION_OCTET_STREAM
          : MediaType.parseMediaType(mimeType);
    } catch (IllegalArgumentException exception) {
      return MediaType.APPLICATION_OCTET_STREAM;
    }
  }
}
