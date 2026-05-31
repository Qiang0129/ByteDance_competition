package com.labelhub.agent.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "labelhub")
public class AgentProperties {

  private final Backend backend = new Backend();
  private final Worker worker = new Worker();
  private final Llm llm = new Llm();

  public Backend getBackend() {
    return backend;
  }

  public Worker getWorker() {
    return worker;
  }

  public Llm getLlm() {
    return llm;
  }

  public static class Backend {
    private String baseUrl = "http://localhost:8080";
    private String username = "system_agent";
    private String password = "agent123";
    private String role = "system_agent";

    public String getBaseUrl() {
      return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
      this.baseUrl = trimTrailingSlash(baseUrl);
    }

    public String getUsername() {
      return username;
    }

    public void setUsername(String username) {
      this.username = username;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password;
    }

    public String getRole() {
      return role;
    }

    public void setRole(String role) {
      this.role = role;
    }
  }

  public static class Worker {
    private boolean enabled = true;
    private int concurrency = 3;
    private long pollIntervalMs = 5000;
    private long idleDelayMs = 1500;

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public int getConcurrency() {
      return concurrency;
    }

    public void setConcurrency(int concurrency) {
      this.concurrency = concurrency;
    }

    public long getPollIntervalMs() {
      return pollIntervalMs;
    }

    public void setPollIntervalMs(long pollIntervalMs) {
      this.pollIntervalMs = pollIntervalMs;
    }

    public long getIdleDelayMs() {
      return idleDelayMs;
    }

    public void setIdleDelayMs(long idleDelayMs) {
      this.idleDelayMs = idleDelayMs;
    }
  }

  public static class Llm {
    private String baseUrl = "https://www.pqapi.store/v1";
    private String apiKey = "";
    private String model = "gpt-5.5";
    private String reasoningEffort = "high";
    private String wireApi = "responses";
    private long timeoutMs = 120000;

    public String getBaseUrl() {
      return baseUrl;
    }

    public void setBaseUrl(String baseUrl) {
      this.baseUrl = trimTrailingSlash(baseUrl);
    }

    public String getApiKey() {
      return apiKey;
    }

    public void setApiKey(String apiKey) {
      this.apiKey = apiKey;
    }

    public String getModel() {
      return model;
    }

    public void setModel(String model) {
      this.model = model;
    }

    public String getReasoningEffort() {
      return reasoningEffort;
    }

    public void setReasoningEffort(String reasoningEffort) {
      this.reasoningEffort = reasoningEffort;
    }

    public String getWireApi() {
      return wireApi;
    }

    public void setWireApi(String wireApi) {
      this.wireApi = wireApi;
    }

    public long getTimeoutMs() {
      return timeoutMs;
    }

    public void setTimeoutMs(long timeoutMs) {
      this.timeoutMs = timeoutMs;
    }
  }

  private static String trimTrailingSlash(String value) {
    if (value == null || value.isBlank()) {
      return "";
    }
    return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
  }
}
