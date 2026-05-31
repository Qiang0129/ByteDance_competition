package com.labelhub.backend.labeler;

import com.labelhub.backend.task.PageResponse;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/labeler")
public class LabelerReturnedItemsController {

  private final LabelerReturnedItemsService returnedItemsService;

  public LabelerReturnedItemsController(LabelerReturnedItemsService returnedItemsService) {
    this.returnedItemsService = returnedItemsService;
  }

  @GetMapping("/returned-items")
  public PageResponse<LabelerReturnedItemResponse> listReturnedItems(
      Authentication authentication,
      @RequestParam(required = false) String source,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return returnedItemsService.listReturnedItems(authentication, source, page, pageSize);
  }
}
