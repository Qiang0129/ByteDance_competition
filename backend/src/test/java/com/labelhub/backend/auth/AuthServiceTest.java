package com.labelhub.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

@ExtendWith(MockitoExtension.class)
class AuthServiceTest {

  @Mock
  private AuthRepository authRepository;

  @Mock
  private PasswordEncoder passwordEncoder;

  @Mock
  private TokenService tokenService;

  @Mock
  private TurnstileVerificationService turnstileVerificationService;

  private AuthProperties authProperties;
  private AuthService authService;

  @BeforeEach
  void setUp() {
    authProperties = new AuthProperties();
    authProperties.setServiceLoginToken("service-token");
    authService = new AuthService(
        authProperties,
        authRepository,
        passwordEncoder,
        tokenService,
        turnstileVerificationService);
  }

  @Test
  void browserLoginRequiresTurnstileBeforeIssuingToken() {
    mockSuccessfulLogin("labeler");

    LoginResponse response = authService.login(
        new LoginRequest("labeler", "labeler123", null, "cf-token"),
        null,
        "127.0.0.1");

    assertThat(response.accessToken()).isEqualTo("issued-token");
    verify(turnstileVerificationService).verify("cf-token", "127.0.0.1");
    verify(authRepository).updateLastLoginAt(7L);
  }

  @Test
  void systemAgentWithServiceTokenBypassesTurnstileOnlyForMachineLogin() {
    mockSuccessfulLogin("system_agent");

    LoginResponse response = authService.login(
        new LoginRequest("system_agent", "agent123", "system_agent", null),
        "service-token",
        "127.0.0.1");

    assertThat(response.accessToken()).isEqualTo("issued-token");
    verify(turnstileVerificationService, never()).verify(anyString(), anyString());
    verify(authRepository).updateLastLoginAt(7L);
  }

  @Test
  void wrongServiceTokenDoesNotBypassTurnstile() {
    mockSuccessfulLogin("system_agent");

    authService.login(
        new LoginRequest("system_agent", "agent123", "system_agent", "cf-token"),
        "wrong-token",
        "127.0.0.1");

    verify(turnstileVerificationService).verify("cf-token", "127.0.0.1");
  }

  @Test
  void registerStopsBeforeDatabaseWriteWhenTurnstileFails() {
    doThrow(new ApiException(HttpStatus.BAD_REQUEST, "TURNSTILE_FAILED", "human verification failed"))
        .when(turnstileVerificationService)
        .verify("bad-token", "127.0.0.1");

    assertThatThrownBy(() -> authService.register(
        new RegisterRequest("new_user", "password123", "labeler", null, "bad-token"),
        "127.0.0.1"))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("TURNSTILE_FAILED");

    verify(authRepository, never()).usernameExists(anyString());
  }

  private void mockSuccessfulLogin(String role) {
    UserAccount user = new UserAccount(7L, role, "Demo User", null, "hash", "active");
    when(authRepository.findUserByUsername(role)).thenReturn(Optional.of(user));
    when(passwordEncoder.matches(anyString(), anyString())).thenReturn(true);
    when(authRepository.findRoleCodes(7L)).thenReturn(List.of(role));
    when(tokenService.issueToken(7L))
        .thenReturn(new SessionPrincipal("issued-token", 7L, Instant.now().plusSeconds(7200)));
  }
}
