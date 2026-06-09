package com.labelhub.backend.auth;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Order(0)
public class DemoUserInitializer implements ApplicationRunner {

  private final AuthProperties authProperties;
  private final AuthRepository authRepository;
  private final PasswordEncoder passwordEncoder;

  public DemoUserInitializer(
      AuthProperties authProperties,
      AuthRepository authRepository,
      PasswordEncoder passwordEncoder) {
    this.authProperties = authProperties;
    this.authRepository = authRepository;
    this.passwordEncoder = passwordEncoder;
  }

  @Override
  public void run(ApplicationArguments args) {
    if (!authProperties.getDemoUsers().isEnabled()) {
      return;
    }

    AuthProperties.DemoUsers demoUsers = authProperties.getDemoUsers();
    authRepository.upsertDemoUser(
        "owner", "Owner Demo", passwordEncoder.encode(demoUsers.getOwnerPassword()), "owner");
    authRepository.upsertDemoUser(
        "labeler", "Labeler Demo", passwordEncoder.encode(demoUsers.getLabelerPassword()), "labeler");
    authRepository.upsertDemoUser(
        "reviewer", "Reviewer Demo", passwordEncoder.encode(demoUsers.getReviewerPassword()), "reviewer");
    authRepository.upsertDemoUser(
        "ai_reviewer",
        "AI Reviewer Demo",
        passwordEncoder.encode(demoUsers.getAiReviewerPassword()),
        "ai_reviewer");
    authRepository.upsertDemoUser(
        "system_agent",
        "System Agent",
        passwordEncoder.encode(demoUsers.getSystemAgentPassword()),
        "system_agent");
    authRepository.upsertDemoUser(
        "demo",
        "All Roles Demo",
        passwordEncoder.encode(demoUsers.getAllRolesPassword()),
        "owner",
        "labeler",
        "reviewer",
        "ai_reviewer");
  }
}
