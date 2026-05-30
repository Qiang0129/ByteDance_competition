package com.labelhub.backend.ai;

import org.springframework.security.core.Authentication;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/ai-review/model-config")
public class AiModelConfigController {

  private final AiModelConfigService service;

  public AiModelConfigController(AiModelConfigService service) {
    this.service = service;
  }

  @GetMapping
  public ResponseEntity<AiModelConfigResponse> getConfig(Authentication authentication) {
    AiModelConfigResponse response = service.getConfig(authentication);
    return response == null ? ResponseEntity.noContent().build() : ResponseEntity.ok(response);
  }

  @PutMapping
  public AiModelConfigResponse saveConfig(
      Authentication authentication,
      @RequestBody AiModelConfigRequest request) {
    return service.saveConfig(authentication, request);
  }

  @PostMapping("/models")
  public AiModelModelsResponse listModels(
      Authentication authentication,
      @RequestBody(required = false) AiModelModelsRequest request) {
    return service.listModels(authentication, request);
  }

  @GetMapping("/runtime")
  public AiModelConfigRuntimeResponse getRuntimeConfig(Authentication authentication) {
    return service.getRuntimeConfig(authentication);
  }
}
