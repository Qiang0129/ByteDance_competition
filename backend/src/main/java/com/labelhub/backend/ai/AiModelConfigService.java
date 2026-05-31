package com.labelhub.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.labelhub.backend.auth.ApiException;
import com.labelhub.backend.auth.AuthenticatedUser;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@Service
public class AiModelConfigService {

  private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

  private final AiModelConfigRepository repository;
  private final AiModelConfigCrypto crypto;

  public AiModelConfigService(
      AiModelConfigRepository repository,
      AiModelConfigCrypto crypto) {
    this.repository = repository;
    this.crypto = crypto;
  }

  public AiModelConfigResponse getConfig(Authentication authentication) {
    requireModelManager(authentication);
    return repository.findActive()
        .map(this::toResponse)
        .orElse(null);
  }

  @Transactional
  public AiModelConfigResponse saveConfig(Authentication authentication, AiModelConfigRequest request) {
    AuthenticatedUser operator = requireModelManager(authentication);
    ValidConfig input = validateConfig(request);
    AiModelConfigRepository.AiModelConfigRecord existing = repository.findActive().orElse(null);
    String encryptedApiKey;
    String apiKeyMask;
    if (input.apiKey() == null || input.apiKey().isBlank()) {
      if (existing == null || existing.encryptedApiKey() == null || existing.encryptedApiKey().isBlank()) {
        throw new ApiException(
            HttpStatus.BAD_REQUEST,
            "AI_MODEL_API_KEY_REQUIRED",
            "api key is required for the first model config");
      }
      encryptedApiKey = existing.encryptedApiKey();
      apiKeyMask = existing.apiKeyMask();
    } else {
      encryptedApiKey = crypto.encrypt(input.apiKey());
      apiKeyMask = maskApiKey(input.apiKey());
    }

    long configId;
    if (existing == null) {
      configId = repository.insertActive(
          input.providerName(),
          input.notes(),
          input.licenseUrl(),
          input.apiBaseUrl(),
          input.useFullUrl(),
          input.modelName(),
          input.reasoningEffort(),
          input.wireApi(),
          input.workerConcurrency(),
          encryptedApiKey,
          apiKeyMask,
          operator.id());
    } else {
      int updated = repository.updateActive(
          existing.id(),
          input.providerName(),
          input.notes(),
          input.licenseUrl(),
          input.apiBaseUrl(),
          input.useFullUrl(),
          input.modelName(),
          input.reasoningEffort(),
          input.wireApi(),
          input.workerConcurrency(),
          encryptedApiKey,
          apiKeyMask,
          operator.id());
      if (updated == 0) {
        throw new ApiException(HttpStatus.CONFLICT, "AI_MODEL_CONFIG_CHANGED", "model config changed, please retry");
      }
      configId = existing.id();
    }

    return repository.findActive()
        .map(this::toResponse)
        .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "AI_MODEL_CONFIG_NOT_FOUND", "model config not found"));
  }

  public AiModelModelsResponse listModels(Authentication authentication, AiModelModelsRequest request) {
    requireModelManager(authentication);
    ModelConnection connection = resolveModelConnection(request);
    String modelsUrl = buildModelsUrl(connection.apiBaseUrl(), connection.useFullUrl());
    try {
      JsonNode response = buildProviderClient(connection.apiKey()).get()
          .uri(modelsUrl)
          .retrieve()
          .body(JsonNode.class);
      return new AiModelModelsResponse(parseModelIds(response));
    } catch (RestClientResponseException exception) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "AI_MODEL_LIST_FAILED",
          "model provider returned " + exception.getStatusCode().value());
    } catch (ApiException exception) {
      throw exception;
    } catch (Exception exception) {
      throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "AI_MODEL_LIST_FAILED",
          "model provider request failed");
    }
  }

  public AiModelConfigRuntimeResponse getRuntimeConfig(Authentication authentication) {
    requireSystemAgent(authentication);
    AiModelConfigRepository.AiModelConfigRecord config = repository.findActive()
        .orElseThrow(() -> new ApiException(
            HttpStatus.NOT_FOUND,
            "AI_MODEL_CONFIG_NOT_FOUND",
            "active model config not found"));
    return new AiModelConfigRuntimeResponse(
        config.apiBaseUrl(),
        config.useFullUrl(),
        config.modelName(),
        config.reasoningEffort(),
        config.wireApi(),
        config.workerConcurrency(),
        crypto.decrypt(config.encryptedApiKey()));
  }

  private ModelConnection resolveModelConnection(AiModelModelsRequest request) {
    String requestBaseUrl = normalizeUrl(request == null ? null : request.apiBaseUrl());
    String requestApiKey = trimToNull(request == null ? null : request.apiKey());
    Boolean requestUseFullUrl = request == null ? null : request.useFullUrl();
    if (requestBaseUrl != null && requestApiKey != null) {
      return new ModelConnection(requestBaseUrl, requestUseFullUrl != null && requestUseFullUrl, requestApiKey);
    }

    AiModelConfigRepository.AiModelConfigRecord existing = repository.findActive()
        .orElseThrow(() -> new ApiException(
            HttpStatus.BAD_REQUEST,
            "AI_MODEL_CONFIG_REQUIRED",
            "api base url and api key are required"));
    String baseUrl = requestBaseUrl == null ? existing.apiBaseUrl() : requestBaseUrl;
    boolean useFullUrl = requestUseFullUrl == null ? existing.useFullUrl() : requestUseFullUrl;
    String apiKey = requestApiKey == null ? crypto.decrypt(existing.encryptedApiKey()) : requestApiKey;
    return new ModelConnection(baseUrl, useFullUrl, apiKey);
  }

  private RestClient buildProviderClient(String apiKey) {
    SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
    requestFactory.setConnectTimeout(Duration.ofSeconds(10));
    requestFactory.setReadTimeout(Duration.ofSeconds(60));
    return RestClient.builder()
        .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + apiKey)
        .requestFactory(requestFactory)
        .build();
  }

  private String buildModelsUrl(String apiBaseUrl, boolean useFullUrl) {
    if (useFullUrl) {
      int responsesIndex = apiBaseUrl.lastIndexOf("/responses");
      if (responsesIndex > 0) {
        return apiBaseUrl.substring(0, responsesIndex) + "/models";
      }
      return apiBaseUrl.endsWith("/models") ? apiBaseUrl : trimTrailingSlash(apiBaseUrl) + "/models";
    }
    return trimTrailingSlash(apiBaseUrl) + "/models";
  }

  private List<String> parseModelIds(JsonNode response) {
    JsonNode data = response == null ? null : response.path("data");
    List<String> modelIds = new ArrayList<>();
    if (data != null && data.isArray()) {
      for (JsonNode item : data) {
        String id = item.path("id").asText("");
        if (!id.isBlank()) {
          modelIds.add(id);
        }
      }
    }
    return modelIds;
  }

  private ValidConfig validateConfig(AiModelConfigRequest request) {
    if (request == null) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_MODEL_CONFIG", "model config request is required");
    }
    String providerName = trimToNull(request.providerName());
    String apiBaseUrl = normalizeUrl(request.apiBaseUrl());
    String modelName = trimToNull(request.modelName());
    String reasoningEffort = normalizeReasoningEffort(request.reasoningEffort());
    String wireApi = normalizeWireApi(request.wireApi());
    int workerConcurrency = normalizeWorkerConcurrency(request.workerConcurrency());
    if (providerName == null || apiBaseUrl == null || modelName == null) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_AI_MODEL_CONFIG",
          "providerName, apiBaseUrl and modelName are required");
    }
    return new ValidConfig(
        truncate(providerName, 128),
        truncate(trimToNull(request.notes()), 512),
        truncate(trimToNull(request.licenseUrl()), 512),
        apiBaseUrl,
        request.useFullUrl() != null && request.useFullUrl(),
        truncate(modelName, 128),
        reasoningEffort,
        wireApi,
        workerConcurrency,
        trimToNull(request.apiKey()));
  }

  private String normalizeUrl(String value) {
    String trimmed = trimToNull(value);
    if (trimmed == null) {
      return null;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_MODEL_URL", "api base url must start with http:// or https://");
    }
    return trimTrailingSlash(trimmed);
  }

  private String normalizeReasoningEffort(String value) {
    String normalized = value == null || value.isBlank() ? "high" : value.trim().toLowerCase(Locale.ROOT);
    if (!List.of("minimal", "low", "medium", "high").contains(normalized)) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_AI_MODEL_REASONING_EFFORT",
          "unsupported reasoning effort");
    }
    return normalized;
  }

  private String normalizeWireApi(String value) {
    String normalized = value == null || value.isBlank() ? "responses" : value.trim().toLowerCase(Locale.ROOT);
    if (!"responses".equals(normalized)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_AI_MODEL_WIRE_API", "only responses wire api is supported");
    }
    return normalized;
  }

  private int normalizeWorkerConcurrency(Integer value) {
    int normalized = value == null ? 3 : value;
    if (normalized < 1 || normalized > 10) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "INVALID_AI_MODEL_WORKER_CONCURRENCY",
          "worker concurrency must be between 1 and 10");
    }
    return normalized;
  }

  private AuthenticatedUser requireModelManager(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (principal.roles().contains("system_agent")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "system_agent cannot manage model config");
    }
    if (principal.roles().stream().noneMatch(role -> List.of("owner", "ai_reviewer").contains(role))) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner or ai_reviewer role is required");
    }
    return principal;
  }

  private AuthenticatedUser requireSystemAgent(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("system_agent")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "system_agent role is required");
    }
    return principal;
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "missing or invalid token");
    }
    return principal;
  }

  private AiModelConfigResponse toResponse(AiModelConfigRepository.AiModelConfigRecord record) {
    return new AiModelConfigResponse(
        Long.toString(record.id()),
        record.providerName(),
        record.notes(),
        record.licenseUrl(),
        record.apiBaseUrl(),
        record.useFullUrl(),
        record.modelName(),
        record.reasoningEffort(),
        record.wireApi(),
        record.workerConcurrency(),
        record.apiKeyMask(),
        record.status(),
        formatDateTime(record.updatedAt()),
        record.updatedByName());
  }

  private String maskApiKey(String apiKey) {
    if (apiKey == null || apiKey.isBlank()) {
      return "";
    }
    String trimmed = apiKey.trim();
    if (trimmed.length() <= 8) {
      return "****" + trimmed.substring(Math.max(0, trimmed.length() - 4));
    }
    return trimmed.substring(0, Math.min(6, trimmed.length())) + "..." + trimmed.substring(trimmed.length() - 4);
  }

  private String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isBlank() ? null : trimmed;
  }

  private String trimTrailingSlash(String value) {
    if (value == null) {
      return null;
    }
    String result = value.trim();
    while (result.endsWith("/") && result.length() > "https://".length()) {
      result = result.substring(0, result.length() - 1);
    }
    return result;
  }

  private String truncate(String value, int maxLength) {
    if (value == null || value.length() <= maxLength) {
      return value;
    }
    return value.substring(0, maxLength);
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime == null ? "" : DATE_TIME.format(dateTime);
  }

  private record ValidConfig(
      String providerName,
      String notes,
      String licenseUrl,
      String apiBaseUrl,
      boolean useFullUrl,
      String modelName,
      String reasoningEffort,
      String wireApi,
      int workerConcurrency,
      String apiKey) {}

  private record ModelConnection(String apiBaseUrl, boolean useFullUrl, String apiKey) {}
}
