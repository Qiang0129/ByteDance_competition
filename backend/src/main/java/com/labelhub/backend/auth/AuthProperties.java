package com.labelhub.backend.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "labelhub.auth")
public class AuthProperties {

  private long tokenTtlSeconds = 7200;

  private DemoUsers demoUsers = new DemoUsers();
  private InitialOwner initialOwner = new InitialOwner();
  private Turnstile turnstile = new Turnstile();
  private String serviceLoginToken = "labelhub-local-service-login-token";

  public long getTokenTtlSeconds() {
    return tokenTtlSeconds;
  }

  public void setTokenTtlSeconds(long tokenTtlSeconds) {
    this.tokenTtlSeconds = tokenTtlSeconds;
  }

  public DemoUsers getDemoUsers() {
    return demoUsers;
  }

  public void setDemoUsers(DemoUsers demoUsers) {
    this.demoUsers = demoUsers;
  }

  public InitialOwner getInitialOwner() {
    return initialOwner;
  }

  public void setInitialOwner(InitialOwner initialOwner) {
    this.initialOwner = initialOwner;
  }

  public Turnstile getTurnstile() {
    return turnstile;
  }

  public void setTurnstile(Turnstile turnstile) {
    this.turnstile = turnstile;
  }

  public String getServiceLoginToken() {
    return serviceLoginToken;
  }

  public void setServiceLoginToken(String serviceLoginToken) {
    this.serviceLoginToken = serviceLoginToken;
  }

  public static class Turnstile {
    private String secretKey = "1x0000000000000000000000000000000AA";
    private String siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
    private int timeoutMs = 5000;

    public String getSecretKey() {
      return secretKey;
    }

    public void setSecretKey(String secretKey) {
      this.secretKey = secretKey;
    }

    public String getSiteverifyUrl() {
      return siteverifyUrl;
    }

    public void setSiteverifyUrl(String siteverifyUrl) {
      this.siteverifyUrl = siteverifyUrl;
    }

    public int getTimeoutMs() {
      return timeoutMs;
    }

    public void setTimeoutMs(int timeoutMs) {
      this.timeoutMs = timeoutMs;
    }
  }

  public static class DemoUsers {
    private boolean enabled = true;
    private String ownerPassword = "owner123";
    private String labelerPassword = "labeler123";
    private String reviewerPassword = "reviewer123";
    private String aiReviewerPassword = "ai_reviewer123";
    private String systemAgentPassword = "agent123";
    private String allRolesPassword = "demo123";

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public String getOwnerPassword() {
      return ownerPassword;
    }

    public void setOwnerPassword(String ownerPassword) {
      this.ownerPassword = ownerPassword;
    }

    public String getLabelerPassword() {
      return labelerPassword;
    }

    public void setLabelerPassword(String labelerPassword) {
      this.labelerPassword = labelerPassword;
    }

    public String getReviewerPassword() {
      return reviewerPassword;
    }

    public void setReviewerPassword(String reviewerPassword) {
      this.reviewerPassword = reviewerPassword;
    }

    public String getAiReviewerPassword() {
      return aiReviewerPassword;
    }

    public void setAiReviewerPassword(String aiReviewerPassword) {
      this.aiReviewerPassword = aiReviewerPassword;
    }

    public String getSystemAgentPassword() {
      return systemAgentPassword;
    }

    public void setSystemAgentPassword(String systemAgentPassword) {
      this.systemAgentPassword = systemAgentPassword;
    }

    public String getAllRolesPassword() {
      return allRolesPassword;
    }

    public void setAllRolesPassword(String allRolesPassword) {
      this.allRolesPassword = allRolesPassword;
    }
  }

  public static class InitialOwner {
    private boolean enabled = false;
    private String username = "";
    private String displayName = "Owner";
    private String password = "";

    public boolean isEnabled() {
      return enabled;
    }

    public void setEnabled(boolean enabled) {
      this.enabled = enabled;
    }

    public String getUsername() {
      return username;
    }

    public void setUsername(String username) {
      this.username = username;
    }

    public String getDisplayName() {
      return displayName;
    }

    public void setDisplayName(String displayName) {
      this.displayName = displayName;
    }

    public String getPassword() {
      return password;
    }

    public void setPassword(String password) {
      this.password = password;
    }
  }
}
