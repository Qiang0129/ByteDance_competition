package com.labelhub.backend.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Order(1)
public class InitialOwnerInitializer implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(InitialOwnerInitializer.class);
  private static final int MAX_USERNAME_LENGTH = 64;
  private static final int MAX_DISPLAY_NAME_LENGTH = 128;
  private static final int MIN_PASSWORD_LENGTH = 6;
  private static final int MAX_PASSWORD_LENGTH = 72;

  private final AuthProperties authProperties;
  private final AuthRepository authRepository;
  private final PasswordEncoder passwordEncoder;

  public InitialOwnerInitializer(
      AuthProperties authProperties,
      AuthRepository authRepository,
      PasswordEncoder passwordEncoder) {
    this.authProperties = authProperties;
    this.authRepository = authRepository;
    this.passwordEncoder = passwordEncoder;
  }

  @Override
  public void run(ApplicationArguments args) {
    AuthProperties.InitialOwner initialOwner = authProperties.getInitialOwner();
    if (initialOwner == null || !initialOwner.isEnabled()) {
      return;
    }

    if (authRepository.existsActiveUserByRoleCode("owner")) {
      log.info("Initial owner bootstrap skipped because an active owner already exists");
      return;
    }

    String username = requireTrimmedText(initialOwner.getUsername(), "labelhub.auth.initial-owner.username");
    validateMaxLength(username, MAX_USERNAME_LENGTH, "labelhub.auth.initial-owner.username");
    String password = requirePassword(initialOwner.getPassword());
    validatePassword(password);

    if (authRepository.usernameExists(username)) {
      throw new IllegalStateException(
          "Initial owner username already exists but no active owner is present: " + username);
    }

    String displayName = normalizeDisplayName(initialOwner.getDisplayName());
    validateMaxLength(displayName, MAX_DISPLAY_NAME_LENGTH, "labelhub.auth.initial-owner.display-name");
    authRepository.createUser(username, displayName, passwordEncoder.encode(password), "owner");
    log.info("Initial owner bootstrap created owner user: {}", username);
  }

  private String requireTrimmedText(String value, String propertyName) {
    if (value == null || value.isBlank()) {
      throw new IllegalStateException(propertyName + " is required when initial owner bootstrap is enabled");
    }
    return value.trim();
  }

  private String requirePassword(String password) {
    if (password == null || password.isBlank()) {
      throw new IllegalStateException(
          "labelhub.auth.initial-owner.password is required when initial owner bootstrap is enabled");
    }
    return password;
  }

  private void validateMaxLength(String value, int maxLength, String propertyName) {
    if (value.length() > maxLength) {
      throw new IllegalStateException(propertyName + " is too long when initial owner bootstrap is enabled");
    }
  }

  private void validatePassword(String password) {
    if (password.length() < MIN_PASSWORD_LENGTH || password.length() > MAX_PASSWORD_LENGTH) {
      throw new IllegalStateException(
          "labelhub.auth.initial-owner.password length must be 6-72 when initial owner bootstrap is enabled");
    }
  }

  private String normalizeDisplayName(String displayName) {
    if (displayName == null || displayName.isBlank()) {
      return "Owner";
    }
    return displayName.trim();
  }
}
