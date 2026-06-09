package com.labelhub.backend.auth;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class SystemAgentInitializerTest {

  @Mock
  private AuthRepository authRepository;

  @Mock
  private PasswordEncoder passwordEncoder;

  private AuthProperties authProperties;
  private SystemAgentInitializer initializer;

  @BeforeEach
  void setUp() {
    authProperties = new AuthProperties();
    initializer = new SystemAgentInitializer(authProperties, authRepository, passwordEncoder);
  }

  @Test
  void skipsWhenDisabled() {
    initializer.run(null);

    verifyNoInteractions(authRepository, passwordEncoder);
  }

  @Test
  void upsertsSystemAgentWhenConfigIsComplete() {
    enableSystemAgent(" system_agent ", " System Agent ", "agentSecret123");
    when(passwordEncoder.encode("agentSecret123")).thenReturn("encoded-password");

    initializer.run(null);

    verify(authRepository)
        .upsertDemoUser("system_agent", "System Agent", "encoded-password", "system_agent");
  }

  @Test
  void defaultsBlankDisplayNameToSystemAgent() {
    enableSystemAgent("system_agent", "", "agentSecret123");
    when(passwordEncoder.encode("agentSecret123")).thenReturn("encoded-password");

    initializer.run(null);

    verify(authRepository)
        .upsertDemoUser("system_agent", "System Agent", "encoded-password", "system_agent");
  }

  @Test
  void failsWhenEnabledWithoutUsername() {
    enableSystemAgent("", "System Agent", "agentSecret123");

    assertThatThrownBy(() -> initializer.run(null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("labelhub.auth.system-agent.username");

    verify(authRepository, never()).upsertDemoUser(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void failsWhenEnabledWithoutPassword() {
    enableSystemAgent("system_agent", "System Agent", "");

    assertThatThrownBy(() -> initializer.run(null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("labelhub.auth.system-agent.password");

    verify(authRepository, never()).upsertDemoUser(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void failsWhenPasswordIsTooShort() {
    enableSystemAgent("system_agent", "System Agent", "short");

    assertThatThrownBy(() -> initializer.run(null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("length must be 12-72");

    verify(authRepository, never()).upsertDemoUser(anyString(), anyString(), anyString(), anyString());
  }

  private void enableSystemAgent(String username, String displayName, String password) {
    AuthProperties.SystemAgent systemAgent = authProperties.getSystemAgent();
    systemAgent.setEnabled(true);
    systemAgent.setUsername(username);
    systemAgent.setDisplayName(displayName);
    systemAgent.setPassword(password);
  }
}
