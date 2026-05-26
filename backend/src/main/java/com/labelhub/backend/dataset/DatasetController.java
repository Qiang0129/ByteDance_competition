package com.labelhub.backend.dataset;

import com.fasterxml.jackson.databind.JsonNode;
import com.labelhub.backend.task.PageResponse;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class DatasetController {

  private final DatasetService datasetService;

  public DatasetController(DatasetService datasetService) {
    this.datasetService = datasetService;
  }

  @GetMapping("/datasets")
  public PageResponse<DatasetResponse> listDatasets(Authentication authentication) {
    return datasetService.listDatasets(authentication);
  }

  @PostMapping("/datasets")
  public DatasetResponse createDataset(
      Authentication authentication,
      @Valid @RequestBody CreateDatasetRequest request) {
    return datasetService.createDataset(authentication, request);
  }

  @PostMapping(path = "/datasets/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public DatasetResponse importDataset(
      Authentication authentication,
      @RequestParam(required = false) String taskId,
      @RequestParam String kind,
      @RequestParam(required = false) String name,
      @RequestPart("file") MultipartFile file) {
    return datasetService.importDataset(authentication, taskId, kind, name, file);
  }

  @PostMapping(path = "/datasets/{datasetId}/items/import", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public DatasetResponse importItemsToDataset(
      Authentication authentication,
      @PathVariable long datasetId,
      @RequestPart("file") MultipartFile file) {
    return datasetService.importItemsToDataset(authentication, datasetId, file);
  }

  @GetMapping("/datasets/{datasetId}/items")
  public List<JsonNode> listDatasetItems(
      Authentication authentication,
      @PathVariable long datasetId) {
    return datasetService.listItems(authentication, datasetId);
  }
}
