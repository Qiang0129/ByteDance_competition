package com.labelhub.agent.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.labelhub.agent.config.AgentProperties;
import com.labelhub.agent.model.AiReviewCompleteRequest;
import com.labelhub.agent.model.AiReviewFailRequest;
import com.labelhub.agent.model.AiReviewJobClaimResponse;
import com.labelhub.agent.model.AiModelRuntimeConfig;
import java.time.Duration;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

@Component
public class BackendClient {

  private static final Logger log = LoggerFactory.getLogger(BackendClient.class);
  private static final String SERVICE_LOGIN_TOKEN_HEADER = "X-LabelHub-Service-Login-Token";

  private final RestClient restClient;
  private final AgentProperties properties;
  private volatile String accessToken;

  public BackendClient(RestClient.Builder builder, AgentProperties properties) {
    this.properties = properties;
    SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
    requestFactory.setConnectTimeout(Duration.ofSeconds(10));
    requestFactory.setReadTimeout(Duration.ofSeconds(60));
    this.restClient = builder
        .baseUrl(properties.getBackend().getBaseUrl())
        .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
        .requestFactory(requestFactory)
        .build();
  }

  public AiReviewJobClaimResponse claimNext() {
    try {
      return postAuthorized("/api/ai-review/jobs/claim-next", null, AiReviewJobClaimResponse.class);
    } catch (HttpClientErrorException exception) {
      if (exception.getStatusCode() == HttpStatus.NOT_FOUND) {
        return null;
      }
      throw exception;
    }
  }

  public void complete(String jobId, AiReviewCompleteRequest request) {
    postAuthorized("/api/ai-review/jobs/" + jobId + "/complete", request, JsonNode.class);
  }

  public void fail(String jobId, String errorSummary) {
    fail(jobId, null, errorSummary);
  }

  public void fail(String jobId, String runToken, String errorSummary) {
    postAuthorized(
        "/api/ai-review/jobs/" + jobId + "/fail",
        new AiReviewFailRequest(runToken, errorSummary),
        JsonNode.class);
  }

  public AiModelRuntimeConfig getModelRuntimeConfig() {
    ensureToken();
    try {
      return restClient.get()
          .uri("/api/ai-review/model-config/runtime")
          .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
          .retrieve()
          .body(AiModelRuntimeConfig.class);
    } catch (HttpClientErrorException.Unauthorized exception) {
      accessToken = null;
      ensureToken();
      return restClient.get()
          .uri("/api/ai-review/model-config/runtime")
          .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
          .retrieve()
          .body(AiModelRuntimeConfig.class);
    }
  }

  private <T> T postAuthorized(String path, Object body, Class<T> responseType) {
    ensureToken();
    try {
      return restClient.post()
          .uri(path)
          .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
          .body(body == null ? Map.of() : body)
          .retrieve()
          .body(responseType);
    } catch (HttpClientErrorException.Unauthorized exception) {
      accessToken = null;
      ensureToken();
      return restClient.post()
          .uri(path)
          .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
          .body(body == null ? Map.of() : body)
          .retrieve()
          .body(responseType);
    }
  }

  private void ensureToken() {
    if (accessToken != null && !accessToken.isBlank()) {
      return;
    }
    synchronized (this) {
      if (accessToken != null && !accessToken.isBlank()) {
        return;
      }
      RestClient.RequestBodySpec loginRequest = restClient.post()
          .uri("/api/auth/login");
      String serviceLoginToken = properties.getBackend().getServiceLoginToken();
      if (serviceLoginToken != null && !serviceLoginToken.isBlank()) {
        loginRequest.header(SERVICE_LOGIN_TOKEN_HEADER, serviceLoginToken);
      }
      LoginResponse response = loginRequest
          .body(Map.of(
              "username", properties.getBackend().getUsername(),
              "password", properties.getBackend().getPassword(),
              "role", properties.getBackend().getRole()))
          .retrieve()
          .body(LoginResponse.class);
      if (response == null || response.accessToken() == null || response.accessToken().isBlank()) {
        throw new IllegalStateException("LabelHub backend login did not return an access token");
      }
      accessToken = response.accessToken();
      log.info("LabelHub Agent logged in as {}", properties.getBackend().getUsername());
    }
  }

  private record LoginResponse(String accessToken, String tokenType, long expiresIn, JsonNode user) {}
}
