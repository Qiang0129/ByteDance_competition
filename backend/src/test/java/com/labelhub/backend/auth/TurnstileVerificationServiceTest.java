package com.labelhub.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

class TurnstileVerificationServiceTest {

  @Test
  void missingTokenReturnsRequiredError() {
    TurnstileVerificationService service = new TurnstileVerificationService(new AuthProperties());

    assertThatThrownBy(() -> service.verify(" ", "127.0.0.1"))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("TURNSTILE_REQUIRED");
  }

  @Test
  void successfulSiteverifyResponsePassesAndSendsExpectedForm() throws IOException {
    AtomicReference<String> requestBody = new AtomicReference<>();
    HttpServer server = startServer(200, "{\"success\":true}", requestBody);
    try {
      TurnstileVerificationService service = new TurnstileVerificationService(
          propertiesWithSiteverifyUrl(serverUrl(server)));

      service.verify("client-token", "127.0.0.1");

      assertThat(requestBody.get()).contains("secret=secret-key");
      assertThat(requestBody.get()).contains("response=client-token");
      assertThat(requestBody.get()).contains("remoteip=127.0.0.1");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void failedSiteverifyResponseReturnsFailedError() throws IOException {
    HttpServer server = startServer(
        200,
        "{\"success\":false,\"error-codes\":[\"timeout-or-duplicate\"]}",
        new AtomicReference<>());
    try {
      TurnstileVerificationService service = new TurnstileVerificationService(
          propertiesWithSiteverifyUrl(serverUrl(server)));

      assertThatThrownBy(() -> service.verify("client-token", "127.0.0.1"))
          .isInstanceOf(ApiException.class)
          .extracting(error -> ((ApiException) error).getCode())
          .isEqualTo("TURNSTILE_FAILED");
    } finally {
      server.stop(0);
    }
  }

  @Test
  void unavailableSiteverifyResponseReturnsUnavailableError() throws IOException {
    HttpServer server = startServer(500, "siteverify unavailable", new AtomicReference<>());
    try {
      TurnstileVerificationService service = new TurnstileVerificationService(
          propertiesWithSiteverifyUrl(serverUrl(server)));

      assertThatThrownBy(() -> service.verify("client-token", "127.0.0.1"))
          .isInstanceOf(ApiException.class)
          .extracting(error -> ((ApiException) error).getCode())
          .isEqualTo("TURNSTILE_UNAVAILABLE");
    } finally {
      server.stop(0);
    }
  }

  private AuthProperties propertiesWithSiteverifyUrl(String siteverifyUrl) {
    AuthProperties properties = new AuthProperties();
    properties.getTurnstile().setSecretKey("secret-key");
    properties.getTurnstile().setSiteverifyUrl(siteverifyUrl);
    properties.getTurnstile().setTimeoutMs(2000);
    return properties;
  }

  private HttpServer startServer(
      int status,
      String responseBody,
      AtomicReference<String> requestBody) throws IOException {
    HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext("/", exchange -> {
      byte[] requestBytes = exchange.getRequestBody().readAllBytes();
      requestBody.set(new String(requestBytes, StandardCharsets.UTF_8));
      byte[] responseBytes = responseBody.getBytes(StandardCharsets.UTF_8);
      exchange.getResponseHeaders().add("Content-Type", "application/json");
      exchange.sendResponseHeaders(status, responseBytes.length);
      exchange.getResponseBody().write(responseBytes);
      exchange.close();
    });
    server.start();
    return server;
  }

  private String serverUrl(HttpServer server) {
    return "http://127.0.0.1:" + server.getAddress().getPort() + "/";
  }
}
