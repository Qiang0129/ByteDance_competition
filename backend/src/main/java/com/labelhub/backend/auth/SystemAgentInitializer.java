package com.labelhub.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Order(2)
public class SystemAgentInitializer implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(SystemAgentInitializer.class);
  private static final int MAX_USERNAME_LENGTH = 64;
  private static final int MAX_DISPLAY_NAME_LENGTH = 128;
  private static final int MIN_PASSWORD_LENGTH = 12;
  private static final int MAX_PASSWORD_LENGTH = 72;

  private final AuthProperties authProperties;
  private final AuthRepository authRepository;
  private final PasswordEncoder passwordEncoder;

  public SystemAgentInitializer(
      AuthProperties authProperties,
      AuthRepository authRepository,
      PasswordEncoder passwordEncoder) {
    this.authProperties = authProperties;
    this.authRepository = authRepository;
    this.passwordEncoder = passwordEncoder;
  }

  @Override
  public void run(ApplicationArguments args) {
    AuthProperties.SystemAgent systemAgent = authProperties.getSystemAgent();
    if (systemAgent == null || !systemAgent.isEnabled()) {
      return;
    }

    String username = requireTrimmedText(systemAgent.getUsername(), "labelhub.auth.system-agent.username");
    validateMaxLength(username, MAX_USERNAME_LENGTH, "labelhub.auth.system-agent.username");
    String displayName = normalizeDisplayName(systemAgent.getDisplayName());
    validateMaxLength(displayName, MAX_DISPLAY_NAME_LENGTH, "labelhub.auth.system-agent.display-name");
    String password = requirePassword(systemAgent.getPassword());
    validatePassword(password);

    authRepository.upsertDemoUser(
        username,
        displayName,
        passwordEncoder.encode(password),
        "system_agent");
    log.info("System agent bootstrap upserted machine user: {}", username);
  }

  private String requireTrimmedText(String value, String propertyName) {
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(propertyName + " is required when system agent bootstrap is enabled");
    }
    return value.trim();
  }

  private String requirePassword(String password) {
    if (password == null || password.isBlank()) {
      throw new IllegalStateException(
          "labelhub.auth.system-agent.password is required when system agent bootstrap is enabled");
    }
    return password;
  }

  private void validateMaxLength(String value, int maxLength, String propertyName) {
    if (value.length() > maxLength) {
      throw new IllegalStateException(propertyName + " is too long when system agent bootstrap is enabled");
    }
  }

  private void validatePassword(String password) {
    if (password.length() < MIN_PASSWORD_LENGTH || password.length() > MAX_PASSWORD_LENGTH) {
      throw new IllegalStateException(
          "labelhub.auth.system-agent.password length must be 12-72 when system agent bootstrap is enabled");
    }
  }

  private String normalizeDisplayName(String displayName) {
    if (displayName == null || displayName.isBlank()) {
      return "System Agent";
    }
    return displayName.trim();
  }
}
