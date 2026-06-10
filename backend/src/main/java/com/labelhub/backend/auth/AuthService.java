package com.labelhub.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

  private static final Logger LOGGER = LoggerFactory.getLogger(AuthService.class);
  private static final List<String> LOGIN_ROLES =
      List.of("owner", "labeler", "reviewer", "ai_reviewer", "system_agent");
  private static final int REVIEWER_INVITE_TTL_HOURS = 24;
  private static final int OWNER_INVITE_TTL_HOURS = 24;
  private static final int RESET_CODE_BOUND = 1_000_000;
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();

  private final AuthProperties authProperties;
  private final AuthRepository authRepository;
  private final PasswordEncoder passwordEncoder;
  private final TokenService tokenService;
  private final TurnstileVerificationService turnstileVerificationService;
  private final PasswordResetCodeStore passwordResetCodeStore;
  private final PasswordResetMailService passwordResetMailService;

  public AuthService(
      AuthProperties authProperties,
      AuthRepository authRepository,
      PasswordEncoder passwordEncoder,
      TokenService tokenService,
      TurnstileVerificationService turnstileVerificationService,
      PasswordResetCodeStore passwordResetCodeStore,
      PasswordResetMailService passwordResetMailService) {
    this.authProperties = authProperties;
    this.authRepository = authRepository;
    this.passwordEncoder = passwordEncoder;
    this.tokenService = tokenService;
    this.turnstileVerificationService = turnstileVerificationService;
    this.passwordResetCodeStore = passwordResetCodeStore;
    this.passwordResetMailService = passwordResetMailService;
  }

  public LoginResponse login(LoginRequest request) {
    return login(request, null, null);
  }

  public LoginResponse login(LoginRequest request, String serviceLoginToken, String remoteIp) {
    String requestedRole = normalizeRole(request.role());
    if (!canBypassTurnstile(requestedRole, serviceLoginToken)) {
      turnstileVerificationService.verify(request.turnstileToken(), remoteIp);
    }

    UserAccount user = authRepository.findUserByUsername(request.username())
        .orElseThrow(() -> unauthorized("invalid username or password"));

    if (!"active".equalsIgnoreCase(user.status())) {
      throw new ApiException(HttpStatus.FORBIDDEN, "USER_DISABLED", "user is not active");
    }
    if (!passwordEncoder.matches(request.password(), user.passwordHash())) {
      throw unauthorized("invalid username or password");
    }

    List<String> roles = authRepository.findRoleCodes(user.id());
    if (requestedRole != null && !roles.contains(requestedRole)) {
      throw new ApiException(HttpStatus.FORBIDDEN, "ROLE_MISMATCH", "user does not have selected role");
    }

    SessionPrincipal principal = tokenService.issueToken(user.id());
    authRepository.updateLastLoginAt(user.id());

    return new LoginResponse(
        principal.token(),
        "Bearer",
        authProperties.getTokenTtlSeconds(),
        toAuthUser(user, roles));
  }

  public CurrentUserResponse getCurrentUser(String authorizationHeader) {
    SessionPrincipal principal = tokenService.resolve(authorizationHeader)
        .orElseThrow(() -> unauthorized("missing or invalid token"));
    UserAccount user = authRepository.findUserById(principal.userId())
        .orElseThrow(() -> unauthorized("user no longer exists"));
    List<String> roles = authRepository.findRoleCodes(user.id());
    List<String> permissions = authRepository.findPermissionCodes(user.id());

    return new CurrentUserResponse(toAuthUser(user, roles), permissions);
  }

  public CurrentUserResponse getCurrentUser(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    return new CurrentUserResponse(
        new AuthUserResponse(
            Long.toString(principal.id()),
            principal.username(),
            principal.displayName(),
            principal.roles()),
        principal.permissions());
  }

  @Transactional
  public AuthUserResponse register(RegisterRequest request) {
    return register(request, null);
  }

  @Transactional
  public AuthUserResponse register(RegisterRequest request, String remoteIp) {
    turnstileVerificationService.verify(request.turnstileToken(), remoteIp);

    String username = request.username().trim();
    String reviewerInviteToken = normalizeInviteToken(request.inviteToken());
    String ownerInviteToken = normalizeInviteToken(request.ownerInviteToken());
    ReviewerInvitationRecord reviewerInvitation = null;
    OwnerInvitationRecord ownerInvitation = null;
    String role = "labeler";

    if (reviewerInviteToken != null && ownerInviteToken != null) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "MULTIPLE_INVITATIONS",
          "only one invitation token can be used at a time");
    }

    if (authRepository.usernameExists(username)) {
      throw new ApiException(HttpStatus.CONFLICT, "USERNAME_EXISTS", "username already exists");
    }

    if (reviewerInviteToken != null) {
      reviewerInvitation = requireUsableReviewerInvitation(reviewerInviteToken);
      role = "reviewer";
    } else if (ownerInviteToken != null) {
      ownerInvitation = requireUsableOwnerInvitation(ownerInviteToken);
      role = "owner";
    }

    UserAccount user = authRepository.createUser(
        username,
        username,
        passwordEncoder.encode(request.password()),
        role);
    if (reviewerInvitation != null) {
      int marked = authRepository.markReviewerInvitationUsed(reviewerInvitation.id(), user.id());
      if (marked == 0) {
        throw new ApiException(HttpStatus.CONFLICT, "INVITATION_USED", "invitation has already been used");
      }
    } else if (ownerInvitation != null) {
      int marked = authRepository.markOwnerInvitationUsed(ownerInvitation.id(), user.id());
      if (marked == 0) {
        throw new ApiException(
            HttpStatus.CONFLICT,
            "OWNER_INVITATION_USED",
            "owner invitation has already been used");
      }
    }
    return toAuthUser(user, authRepository.findRoleCodes(user.id()));
  }

  public CreateReviewerInvitationResponse createReviewerInvitation(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    String token = generateInviteToken();
    LocalDateTime expiresAt = LocalDateTime.now().plusHours(REVIEWER_INVITE_TTL_HOURS);
    authRepository.createReviewerInvitation(hashToken(token), owner.id(), expiresAt);
    return new CreateReviewerInvitationResponse(token, formatDateTime(expiresAt));
  }

  public CreateOwnerInvitationResponse createOwnerInvitation(Authentication authentication) {
    AuthenticatedUser owner = requireOwner(authentication);
    String token = generateInviteToken();
    LocalDateTime expiresAt = LocalDateTime.now().plusHours(OWNER_INVITE_TTL_HOURS);
    authRepository.createOwnerInvitation(hashToken(token), owner.id(), expiresAt);
    return new CreateOwnerInvitationResponse(token, formatDateTime(expiresAt));
  }

  public ReviewerInvitationValidationResponse validateReviewerInvitation(String token) {
    String inviteToken = normalizeInviteToken(token);
    if (inviteToken == null) {
      return new ReviewerInvitationValidationResponse(false, "invalid", null);
    }
    return authRepository.findReviewerInvitationByTokenHash(hashToken(inviteToken))
        .map(this::toInvitationValidationResponse)
        .orElseGet(() -> new ReviewerInvitationValidationResponse(false, "invalid", null));
  }

  public OwnerInvitationValidationResponse validateOwnerInvitation(String token) {
    String inviteToken = normalizeInviteToken(token);
    if (inviteToken == null) {
      return new OwnerInvitationValidationResponse(false, "invalid", null);
    }
    return authRepository.findOwnerInvitationByTokenHash(hashToken(inviteToken))
        .map(this::toOwnerInvitationValidationResponse)
        .orElseGet(() -> new OwnerInvitationValidationResponse(false, "invalid", null));
  }

  public void logout(String authorizationHeader) {
    tokenService.revoke(authorizationHeader);
  }

  public PasswordResetCodeResponse sendPasswordResetCode(PasswordResetCodeRequest request, String remoteIp) {
    turnstileVerificationService.verify(request.turnstileToken(), remoteIp);

    String username = normalizeUsername(request.username());
    String email = normalizeEmail(request.email());
    AuthProperties.PasswordReset passwordReset = authProperties.getPasswordReset();
    int codeTtlSeconds = Math.max(60, passwordReset.getCodeTtlSeconds());
    int cooldownSeconds = Math.max(10, passwordReset.getResendCooldownSeconds());
    PasswordResetCodeResponse response = genericPasswordResetCodeResponse(codeTtlSeconds, cooldownSeconds);

    if (passwordResetCodeStore.isInCooldown(username)) {
      throw new ApiException(
          HttpStatus.TOO_MANY_REQUESTS,
          "PASSWORD_RESET_CODE_COOLDOWN",
          "verification code was sent recently, please try again later");
    }

    Optional<UserAccount> user = authRepository.findUserByUsername(username);
    if (user.isEmpty()) {
      LOGGER.info("Password reset code skipped: user not found, usernameHash={}", hashLogValue(username));
      return response;
    }
    if (!isActive(user.get())) {
      LOGGER.info("Password reset code skipped: inactive user id={}", user.get().id());
      return response;
    }
    PasswordResetEmailCheck emailCheck = checkPasswordResetEmail(user.get(), email);
    if (!emailCheck.allowed()) {
      LOGGER.info(
          "Password reset code skipped: email check failed, userId={}, reason={}, emailDomain={}",
          user.get().id(),
          emailCheck.reason(),
          emailDomain(email));
      return response;
    }

    String code = generateVerificationCode();
    String codeHash = hashPasswordResetCode(username, email, code);
    LOGGER.info(
        "Password reset code accepted: userId={}, emailDomain={}, ttlSeconds={}, cooldownSeconds={}",
        user.get().id(),
        emailDomain(email),
        codeTtlSeconds,
        cooldownSeconds);
    passwordResetCodeStore.save(
        new PasswordResetCodeRecord(user.get().id(), username, email, codeHash, 0),
        Duration.ofSeconds(codeTtlSeconds),
        Duration.ofSeconds(cooldownSeconds));
    try {
      passwordResetMailService.sendResetCode(email, code, Math.max(1, codeTtlSeconds / 60));
    } catch (ApiException exception) {
      passwordResetCodeStore.delete(username);
      throw exception;
    }
    return response;
  }

  @Transactional
  public PasswordResetConfirmResponse confirmPasswordReset(PasswordResetConfirmRequest request) {
    String username = normalizeUsername(request.username());
    String email = normalizeEmail(request.email());
    String code = normalizeResetCode(request.code());

    if (!request.newPassword().equals(request.confirmPassword())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_CONFIRM_MISMATCH", "password confirmation does not match");
    }

    PasswordResetCodeRecord record = passwordResetCodeStore.find(username)
        .orElseThrow(() -> new ApiException(
            HttpStatus.BAD_REQUEST,
            "PASSWORD_RESET_CODE_INVALID",
            "verification code is invalid or expired"));
    if (!record.email().equals(email)) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "PASSWORD_RESET_CODE_INVALID",
          "verification code is invalid or expired");
    }

    int maxAttempts = Math.max(1, authProperties.getPasswordReset().getMaxAttempts());
    if (!MessageDigest.isEqual(
        record.codeHash().getBytes(StandardCharsets.UTF_8),
        hashPasswordResetCode(username, email, code).getBytes(StandardCharsets.UTF_8))) {
      PasswordResetCodeRecord failedRecord = new PasswordResetCodeRecord(
          record.userId(),
          record.username(),
          record.email(),
          record.codeHash(),
          record.attempts() + 1);
      if (failedRecord.attempts() >= maxAttempts) {
        passwordResetCodeStore.delete(username);
      } else {
        passwordResetCodeStore.updateAttempts(failedRecord);
      }
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "PASSWORD_RESET_CODE_INVALID",
          "verification code is invalid or expired");
    }

    UserAccount user = authRepository.findUserById(record.userId())
        .orElseThrow(() -> new ApiException(
            HttpStatus.BAD_REQUEST,
            "PASSWORD_RESET_CODE_INVALID",
            "verification code is invalid or expired"));
    if (!isActive(user) || !checkPasswordResetEmail(user, email).allowed()) {
      passwordResetCodeStore.delete(username);
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "PASSWORD_RESET_CODE_INVALID",
          "verification code is invalid or expired");
    }

    int updated = authRepository.updatePasswordAndBindEmailIfMissing(
        user.id(),
        passwordEncoder.encode(request.newPassword()),
        email);
    if (updated == 0) {
      throw new ApiException(HttpStatus.CONFLICT, "PASSWORD_RESET_FAILED", "password reset failed");
    }
    passwordResetCodeStore.delete(username);
    return new PasswordResetConfirmResponse("password reset successfully");
  }

  private AuthUserResponse toAuthUser(UserAccount user, List<String> roles) {
    return new AuthUserResponse(
        Long.toString(user.id()),
        user.username(),
        user.name(),
        roles);
  }

  private String normalizeRole(String role) {
    if (role == null || role.isBlank()) {
      return null;
    }

    String normalizedRole = role.trim().toLowerCase();
    if (!LOGIN_ROLES.contains(normalizedRole)) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ROLE", "unsupported login role");
    }
    return normalizedRole;
  }

  private boolean canBypassTurnstile(String requestedRole, String providedServiceLoginToken) {
    if (!"system_agent".equals(requestedRole)) {
      return false;
    }

    String expectedToken = authProperties.getServiceLoginToken();
    if (expectedToken == null || expectedToken.isBlank()
        || providedServiceLoginToken == null || providedServiceLoginToken.isBlank()) {
      return false;
    }

    return MessageDigest.isEqual(
        expectedToken.getBytes(StandardCharsets.UTF_8),
        providedServiceLoginToken.trim().getBytes(StandardCharsets.UTF_8));
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw unauthorized("missing or invalid token");
    }
    return principal;
  }

  private AuthenticatedUser requireOwner(Authentication authentication) {
    AuthenticatedUser principal = requirePrincipal(authentication);
    if (!principal.roles().contains("owner")) {
      throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "owner role is required");
    }
    return principal;
  }

  private ReviewerInvitationRecord requireUsableReviewerInvitation(String token) {
    ReviewerInvitationRecord invitation = authRepository.findReviewerInvitationByTokenHash(hashToken(token))
        .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INVITATION", "invalid invitation"));
    if (invitation.usedAt() != null) {
      throw new ApiException(HttpStatus.CONFLICT, "INVITATION_USED", "invitation has already been used");
    }
    if (invitation.expiresAt().isBefore(LocalDateTime.now())) {
      throw new ApiException(HttpStatus.BAD_REQUEST, "INVITATION_EXPIRED", "invitation has expired");
    }
    return invitation;
  }

  private OwnerInvitationRecord requireUsableOwnerInvitation(String token) {
    OwnerInvitationRecord invitation = authRepository.findOwnerInvitationByTokenHash(hashToken(token))
        .orElseThrow(() ->
            new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OWNER_INVITATION", "invalid owner invitation"));
    if (invitation.usedAt() != null) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "OWNER_INVITATION_USED",
          "owner invitation has already been used");
    }
    if (invitation.expiresAt().isBefore(LocalDateTime.now())) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "OWNER_INVITATION_EXPIRED",
          "owner invitation has expired");
    }
    return invitation;
  }

  private ReviewerInvitationValidationResponse toInvitationValidationResponse(ReviewerInvitationRecord invitation) {
    if (invitation.usedAt() != null) {
      return new ReviewerInvitationValidationResponse(false, "used", formatDateTime(invitation.expiresAt()));
    }
    if (invitation.expiresAt().isBefore(LocalDateTime.now())) {
      return new ReviewerInvitationValidationResponse(false, "expired", formatDateTime(invitation.expiresAt()));
    }
    return new ReviewerInvitationValidationResponse(true, null, formatDateTime(invitation.expiresAt()));
  }

  private OwnerInvitationValidationResponse toOwnerInvitationValidationResponse(OwnerInvitationRecord invitation) {
    if (invitation.usedAt() != null) {
      return new OwnerInvitationValidationResponse(false, "used", formatDateTime(invitation.expiresAt()));
    }
    if (invitation.expiresAt().isBefore(LocalDateTime.now())) {
      return new OwnerInvitationValidationResponse(false, "expired", formatDateTime(invitation.expiresAt()));
    }
    return new OwnerInvitationValidationResponse(true, null, formatDateTime(invitation.expiresAt()));
  }

  private String normalizeInviteToken(String token) {
    if (token == null || token.isBlank()) {
      return null;
    }
    return token.trim();
  }

  private String normalizeUsername(String username) {
    return username == null ? "" : username.trim();
  }

  private String normalizeEmail(String email) {
    return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
  }

  private String normalizeResetCode(String code) {
    String normalized = code == null ? "" : code.trim();
    if (!normalized.matches("\\d{6}")) {
      throw new ApiException(
          HttpStatus.BAD_REQUEST,
          "PASSWORD_RESET_CODE_INVALID",
          "verification code is invalid or expired");
    }
    return normalized;
  }

  private boolean isActive(UserAccount user) {
    return "active".equalsIgnoreCase(user.status());
  }

  private PasswordResetEmailCheck checkPasswordResetEmail(UserAccount user, String email) {
    if (email == null || email.isBlank()) {
      return new PasswordResetEmailCheck(false, "blank_email");
    }
    if (authRepository.emailBelongsToAnotherUser(email, user.id())) {
      return new PasswordResetEmailCheck(false, "email_belongs_to_another_user");
    }
    String existingEmail = normalizeEmail(user.email());
    if (existingEmail.isBlank()) {
      return new PasswordResetEmailCheck(true, "missing_existing_email");
    }
    if (!existingEmail.equals(email)) {
      return new PasswordResetEmailCheck(false, "email_mismatch");
    }
    return new PasswordResetEmailCheck(true, "email_match");
  }

  private String hashLogValue(String value) {
    if (value == null || value.isBlank()) {
      return "blank";
    }
    return hashToken(value).substring(0, 12);
  }

  private String emailDomain(String email) {
    if (email == null || email.isBlank()) {
      return "blank";
    }
    int atIndex = email.lastIndexOf('@');
    if (atIndex < 0 || atIndex == email.length() - 1) {
      return "invalid";
    }
    return email.substring(atIndex + 1);
  }

  private PasswordResetCodeResponse genericPasswordResetCodeResponse(
      int codeTtlSeconds,
      int cooldownSeconds) {
    return new PasswordResetCodeResponse(
        "if the account can be verified, a verification code will be sent",
        codeTtlSeconds,
        cooldownSeconds);
  }

  private String generateVerificationCode() {
    return "%06d".formatted(SECURE_RANDOM.nextInt(RESET_CODE_BOUND));
  }

  private String hashPasswordResetCode(String username, String email, String code) {
    return hashToken("%s:%s:%s".formatted(username, email, code));
  }

  private String generateInviteToken() {
    byte[] bytes = new byte[32];
    SECURE_RANDOM.nextBytes(bytes);
    return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
  }

  private String hashToken(String token) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 is not available", error);
    }
  }

  private String formatDateTime(LocalDateTime dateTime) {
    return dateTime.format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
  }

  private ApiException unauthorized(String message) {
    return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
  }

  private record PasswordResetEmailCheck(boolean allowed, String reason) {}
}
