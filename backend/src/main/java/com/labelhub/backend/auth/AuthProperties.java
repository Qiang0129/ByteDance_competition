package com.labelhub.backend.auth;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "labelhub.auth")
public class AuthProperties {

  private long tokenTtlSeconds = 7200;

  private DemoUsers demoUsers = new DemoUsers();

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
}
