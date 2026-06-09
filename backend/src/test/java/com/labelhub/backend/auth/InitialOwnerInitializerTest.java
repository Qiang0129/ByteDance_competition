package com.labelhub.backend.auth;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
class InitialOwnerInitializerTest {

  @Mock
  private AuthRepository authRepository;

  @Mock
  private PasswordEncoder passwordEncoder;

  private AuthProperties authProperties;
  private InitialOwnerInitializer initializer;

  @BeforeEach
  void setUp() {
    authProperties = new AuthProperties();
    initializer = new InitialOwnerInitializer(authProperties, authRepository, passwordEncoder);
  }

  @Test
  void createsOwnerWhenNoActiveOwnerExistsAndConfigIsComplete() {
    enableInitialOwner(" bootstrap_owner ", " Bootstrap Owner ", "ownerSecret123");
    when(authRepository.existsActiveUserByRoleCode("owner")).thenReturn(false);
    when(authRepository.usernameExists("bootstrap_owner")).thenReturn(false);
    when(passwordEncoder.encode("ownerSecret123")).thenReturn("encoded-password");

    initializer.run(null);

    verify(authRepository).createUser("bootstrap_owner", "Bootstrap Owner", "encoded-password", "owner");
  }

  @Test
  void skipsWhenActiveOwnerAlreadyExists() {
    enableInitialOwner("", "", "");
    when(authRepository.existsActiveUserByRoleCode("owner")).thenReturn(true);

    initializer.run(null);

    verify(authRepository, never()).usernameExists(org.mockito.ArgumentMatchers.anyString());
    verify(authRepository, never()).createUser(
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString());
    verifyNoInteractions(passwordEncoder);
  }

  @Test
  void failsWhenEnabledWithoutUsername() {
    enableInitialOwner("", "Owner", "ownerSecret123");
    when(authRepository.existsActiveUserByRoleCode("owner")).thenReturn(false);

    assertThatThrownBy(() -> initializer.run(null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("labelhub.auth.initial-owner.username");

    verify(authRepository, never()).createUser(
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void failsWhenEnabledWithoutPassword() {
    enableInitialOwner("bootstrap_owner", "Owner", "");
    when(authRepository.existsActiveUserByRoleCode("owner")).thenReturn(false);

    assertThatThrownBy(() -> initializer.run(null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("labelhub.auth.initial-owner.password");

    verify(authRepository, never()).createUser(
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void failsWhenUsernameAlreadyExistsWithoutActiveOwner() {
    enableInitialOwner("labeler", "Owner", "ownerSecret123");
    when(authRepository.existsActiveUserByRoleCode("owner")).thenReturn(false);
    when(authRepository.usernameExists("labeler")).thenReturn(true);

    assertThatThrownBy(() -> initializer.run(null))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("Initial owner username already exists");

    verify(authRepository, never()).createUser(
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString(),
        org.mockito.ArgumentMatchers.anyString());
  }

  @Test
  void defaultsBlankDisplayNameToOwner() {
    enableInitialOwner("bootstrap_owner", "", "ownerSecret123");
    when(authRepository.existsActiveUserByRoleCode("owner")).thenReturn(false);
    when(authRepository.usernameExists("bootstrap_owner")).thenReturn(false);
    when(passwordEncoder.encode("ownerSecret123")).thenReturn("encoded-password");

    initializer.run(null);

    verify(authRepository).createUser("bootstrap_owner", "Owner", "encoded-password", "owner");
  }

  private void enableInitialOwner(String username, String displayName, String password) {
    AuthProperties.InitialOwner initialOwner = authProperties.getInitialOwner();
    initialOwner.setEnabled(true);
    initialOwner.setUsername(username);
    initialOwner.setDisplayName(displayName);
    initialOwner.setPassword(password);
  }
}
