package com.labelhub.backend.auth;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

@Service
public class TurnstileVerificationService {

  private static final Logger log = LoggerFactory.getLogger(TurnstileVerificationService.class);

  private final AuthProperties authProperties;

  public TurnstileVerificationService(AuthProperties authProperties) {
    this.authProperties = authProperties;
  }

  public void verify(String token, String remoteIp) {
    if (token == null || token.isBlank()) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "TURNSTILE_REQUIRED", "human verification is required");
    }

    AuthProperties.Turnstile turnstile = authProperties.getTurnstile();
    if (turnstile.getSecretKey() == null || turnstile.getSecretKey().isBlank()) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "TURNSTILE_UNAVAILABLE",
          "human verification is not configured");
    }
    if (turnstile.getSiteverifyUrl() == null || turnstile.getSiteverifyUrl().isBlank()) {
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "TURNSTILE_UNAVAILABLE",
          "human verification endpoint is not configured");
    }

    TurnstileSiteverifyResponse response = requestSiteverify(turnstile, token.trim(), remoteIp);
    if (response == null || !response.success()) {
      List<String> errorCodes = response == null || response.errorCodes() == null
          ? List.of("empty-response")
          : response.errorCodes();
      log.info("Cloudflare Turnstile rejected auth request: {}", errorCodes);
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "TURNSTILE_FAILED",
          "human verification failed, please try again");
    }
  }

  private TurnstileSiteverifyResponse requestSiteverify(
      AuthProperties.Turnstile turnstile,
      String token,
      String remoteIp) {
    MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
    form.add("secret", turnstile.getSecretKey());
    form.add("response", token);
    if (remoteIp != null && !remoteIp.isBlank()) {
      form.add("remoteip", remoteIp);
    }

    try {
      return buildClient(turnstile).post()
          .uri(turnstile.getSiteverifyUrl())
          .contentType(MediaType.APPLICATION_FORM_URLENCODED)
          .body(form)
          .retrieve()
          .body(TurnstileSiteverifyResponse.class);
    } catch (RestClientException exception) {
      log.warn("Cloudflare Turnstile siteverify request failed: {}", exception.getMessage());
      throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          "TURNSTILE_UNAVAILABLE",
          "human verification service is unavailable");
    }
  }

  private RestClient buildClient(AuthProperties.Turnstile turnstile) {
    SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
    Duration timeout = Duration.ofMillis(Math.max(1000, turnstile.getTimeoutMs()));
    requestFactory.setConnectTimeout(timeout);
    requestFactory.setReadTimeout(timeout);
    return RestClient.builder()
        .requestFactory(requestFactory)
        .build();
  }

  private record TurnstileSiteverifyResponse(
      boolean success,
      @JsonProperty("error-codes") List<String> errorCodes,
      String hostname,
      String action,
      @JsonProperty("challenge_ts") String challengeTs) {}
}
