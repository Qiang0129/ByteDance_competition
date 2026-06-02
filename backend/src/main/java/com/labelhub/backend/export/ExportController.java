package com.labelhub.backend.export;

import java.util.List;
import org.springframework.core.io.Resource;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/exports")
public class ExportController {

  private final ExportService exportService;

  public ExportController(ExportService exportService) {
    this.exportService = exportService;
  }

  @PostMapping
  public ExportJobResponse createExport(
      Authentication authentication,
      @RequestBody(required = false) ExportRequest request) {
    return exportService.createExport(authentication, request);
  }

  @GetMapping
  public List<ExportJobResponse> listExports(Authentication authentication) {
    return exportService.listExports(authentication);
  }

  @GetMapping("/overview")
  public ExportOverviewResponse overview(Authentication authentication) {
    return exportService.overview(authentication);
  }

  @GetMapping("/tasks/{taskId}/options")
  public ExportTaskOptionsResponse taskOptions(Authentication authentication, @PathVariable long taskId) {
    return exportService.taskOptions(authentication, taskId);
  }

  @GetMapping("/{exportId}/download")
  public ResponseEntity<Resource> download(Authentication authentication, @PathVariable long exportId) {
    return exportService.download(authentication, exportId);
  }

  @PostMapping("/{exportId}/start")
  public ExportJobResponse start(Authentication authentication, @PathVariable long exportId) {
    return exportService.start(authentication, exportId);
  }

  @PostMapping("/{exportId}/complete")
  public ExportJobResponse complete(Authentication authentication, @PathVariable long exportId) {
    return exportService.complete(authentication, exportId);
  }

  @PostMapping("/{exportId}/fail")
  public ExportJobResponse fail(
      Authentication authentication,
      @PathVariable long exportId,
      @RequestBody(required = false) ExportFailRequest request) {
    return exportService.fail(authentication, exportId, request);
  }
}
