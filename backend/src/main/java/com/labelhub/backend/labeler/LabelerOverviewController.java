package com.labelhub.backend.labeler;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/labeler")
public class LabelerOverviewController {

  private final LabelerOverviewService overviewService;

  public LabelerOverviewController(LabelerOverviewService overviewService) {
    this.overviewService = overviewService;
  }

  @GetMapping("/overview")
  public LabelerOverviewResponse getOverview(Authentication authentication) {
    return overviewService.getOverview(authentication);
  }
}
