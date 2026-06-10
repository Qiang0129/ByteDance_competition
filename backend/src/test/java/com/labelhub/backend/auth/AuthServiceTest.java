package com.labelhub.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
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

  @Mock
  private PasswordResetCodeStore passwordResetCodeStore;

  @Mock
  private PasswordResetMailService passwordResetMailService;

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
        turnstileVerificationService,
        passwordResetCodeStore,
        passwordResetMailService);
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
        new RegisterRequest("new_user", "password123", "labeler", null, null, "bad-token"),
        "127.0.0.1"))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("TURNSTILE_FAILED");

    verify(authRepository, never()).usernameExists(anyString());
  }

  @Test
  void ownerInvitationRegistersOwnerAndMarksInvitationUsed() {
    OwnerInvitationRecord invitation = new OwnerInvitationRecord(
        13L,
        "hash",
        7L,
        LocalDateTime.now().plusHours(1),
        null,
        null);
    UserAccount createdUser = new UserAccount(21L, "new_owner", "new_owner", null, "hash", "active");

    when(authRepository.usernameExists("new_owner")).thenReturn(false);
    when(authRepository.findOwnerInvitationByTokenHash(anyString())).thenReturn(Optional.of(invitation));
    when(passwordEncoder.encode("password123")).thenReturn("encoded-password");
    when(authRepository.createUser("new_owner", "new_owner", "encoded-password", "owner"))
        .thenReturn(createdUser);
    when(authRepository.markOwnerInvitationUsed(13L, 21L)).thenReturn(1);
    when(authRepository.findRoleCodes(21L)).thenReturn(List.of("owner"));

    AuthUserResponse response = authService.register(
        new RegisterRequest("new_owner", "password123", "labeler", null, "owner-token", "cf-token"),
        "127.0.0.1");

    assertThat(response.roles()).containsExactly("owner");
    verify(turnstileVerificationService).verify("cf-token", "127.0.0.1");
    verify(authRepository).markOwnerInvitationUsed(13L, 21L);
  }

  @Test
  void registerRejectsMultipleInvitationTokens() {
    assertThatThrownBy(() -> authService.register(
        new RegisterRequest("new_user", "password123", "labeler", "reviewer-token", "owner-token", "cf-token"),
        "127.0.0.1"))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("MULTIPLE_INVITATIONS");

    verify(authRepository, never()).usernameExists(anyString());
    verify(authRepository, never()).createUser(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void registerRejectsInvalidOwnerInvitation() {
    when(authRepository.usernameExists("new_owner")).thenReturn(false);
    when(authRepository.findOwnerInvitationByTokenHash(anyString())).thenReturn(Optional.empty());

    assertThatThrownBy(() -> authService.register(
        new RegisterRequest("new_owner", "password123", "labeler", null, "bad-owner-token", "cf-token"),
        "127.0.0.1"))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("INVALID_OWNER_INVITATION");

    verify(authRepository, never()).createUser(anyString(), anyString(), anyString(), anyString());
  }

  @Test
  void ownerCanCreateOwnerInvitation() {
    when(authRepository.createOwnerInvitation(anyString(), eq(7L), any(LocalDateTime.class)))
        .thenReturn(99L);

    CreateOwnerInvitationResponse response = authService.createOwnerInvitation(ownerAuthentication());

    assertThat(response.token()).isNotBlank();
    assertThat(response.expiresAt()).isNotBlank();
    verify(authRepository).createOwnerInvitation(anyString(), eq(7L), any(LocalDateTime.class));
  }

  @Test
  void passwordResetCodeCanBeSentForActiveUserWithoutEmail() {
    UserAccount user = new UserAccount(7L, "reviewer1", "Reviewer", null, "hash", "active");
    when(authRepository.findUserByUsername("reviewer1")).thenReturn(Optional.of(user));
    when(authRepository.emailBelongsToAnotherUser("reviewer1@example.com", 7L)).thenReturn(false);
    when(passwordResetCodeStore.isInCooldown("reviewer1")).thenReturn(false);

    PasswordResetCodeResponse response = authService.sendPasswordResetCode(
        new PasswordResetCodeRequest("reviewer1", "Reviewer1@Example.com", "cf-token"),
        "127.0.0.1");

    assertThat(response.expiresInSeconds()).isEqualTo(600);
    verify(turnstileVerificationService).verify("cf-token", "127.0.0.1");
    verify(passwordResetCodeStore).save(any(PasswordResetCodeRecord.class), any(), any());
    verify(passwordResetMailService).sendResetCode(eq("reviewer1@example.com"), anyString(), eq(10));
  }

  @Test
  void passwordResetConfirmUpdatesPasswordAndBindsMissingEmail() {
    UserAccount user = new UserAccount(7L, "reviewer1", "Reviewer", null, "hash", "active");
    PasswordResetCodeRecord record = new PasswordResetCodeRecord(
        7L,
        "reviewer1",
        "reviewer1@example.com",
        hashPasswordResetCodeForTest("reviewer1", "reviewer1@example.com", "123456"),
        0);

    when(passwordResetCodeStore.find("reviewer1")).thenReturn(Optional.of(record));
    when(authRepository.findUserById(7L)).thenReturn(Optional.of(user));
    when(authRepository.emailBelongsToAnotherUser("reviewer1@example.com", 7L)).thenReturn(false);
    when(passwordEncoder.encode("newpass123")).thenReturn("encoded-password");
    when(authRepository.updatePasswordAndBindEmailIfMissing(7L, "encoded-password", "reviewer1@example.com"))
        .thenReturn(1);

    PasswordResetConfirmResponse response = authService.confirmPasswordReset(
        new PasswordResetConfirmRequest(
            "reviewer1",
            "reviewer1@example.com",
            "123456",
            "newpass123",
            "newpass123"));

    assertThat(response.message()).isEqualTo("password reset successfully");
    verify(authRepository).updatePasswordAndBindEmailIfMissing(7L, "encoded-password", "reviewer1@example.com");
    verify(passwordResetCodeStore).delete("reviewer1");
  }

  @Test
  void nonOwnerCannotCreateOwnerInvitation() {
    assertThatThrownBy(() -> authService.createOwnerInvitation(labelerAuthentication()))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("FORBIDDEN");

    verify(authRepository, never()).createOwnerInvitation(anyString(), eq(7L), any(LocalDateTime.class));
  }

  private void mockSuccessfulLogin(String role) {
    UserAccount user = new UserAccount(7L, role, "Demo User", null, "hash", "active");
    when(authRepository.findUserByUsername(role)).thenReturn(Optional.of(user));
    when(passwordEncoder.matches(anyString(), anyString())).thenReturn(true);
    when(authRepository.findRoleCodes(7L)).thenReturn(List.of(role));
    when(tokenService.issueToken(7L))
        .thenReturn(new SessionPrincipal("issued-token", 7L, Instant.now().plusSeconds(7200)));
  }

  private UsernamePasswordAuthenticationToken ownerAuthentication() {
    return authentication(List.of("owner"));
  }

  private UsernamePasswordAuthenticationToken labelerAuthentication() {
    return authentication(List.of("labeler"));
  }

  private UsernamePasswordAuthenticationToken authentication(List<String> roles) {
    return new UsernamePasswordAuthenticationToken(
        new AuthenticatedUser(7L, "demo", "Demo User", roles, List.of()),
        null);
  }

  private String hashPasswordResetCodeForTest(String username, String email, String code) {
    try {
      java.security.MessageDigest digest = java.security.MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest("%s:%s:%s".formatted(username, email, code)
          .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      return java.util.HexFormat.of().formatHex(hash);
    } catch (java.security.NoSuchAlgorithmException error) {
      throw new IllegalStateException(error);
    }
  }
}
