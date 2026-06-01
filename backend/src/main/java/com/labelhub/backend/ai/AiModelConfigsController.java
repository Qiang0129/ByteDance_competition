package com.labelhub.backend.ai;

import java.util.List;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai-review/model-configs")
public class AiModelConfigsController {

  private final AiModelConfigService service;

  public AiModelConfigsController(AiModelConfigService service) {
    this.service = service;
  }

  @GetMapping
  public List<AiModelConfigResponse> listConfigs(Authentication authentication) {
    return service.listConfigs(authentication);
  }

  @PostMapping
  public AiModelConfigResponse createConfig(
      Authentication authentication,
      @RequestBody AiModelConfigRequest request) {
    return service.createConfig(authentication, request);
  }

  @PutMapping("/{configId}")
  public AiModelConfigResponse updateConfig(
      Authentication authentication,
      @PathVariable long configId,
      @RequestBody AiModelConfigRequest request) {
    return service.updateConfig(authentication, configId, request);
  }

  @DeleteMapping("/{configId}")
  public void deleteConfig(Authentication authentication, @PathVariable long configId) {
    service.deleteConfig(authentication, configId);
  }

  @PostMapping("/{configId}/activate")
  public AiModelConfigResponse activateConfig(Authentication authentication, @PathVariable long configId) {
    return service.activateConfig(authentication, configId);
  }
}
