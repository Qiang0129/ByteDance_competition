package com.labelhub.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

  private static final List<String> LOGIN_ROLES =
      List.of("owner", "labeler", "reviewer", "ai_reviewer", "system_agent");
  private static final int REVIEWER_INVITE_TTL_HOURS = 24;
  private static final int OWNER_INVITE_TTL_HOURS = 24;
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();

  private final AuthProperties authProperties;
  private final AuthRepository authRepository;
  private final PasswordEncoder passwordEncoder;
  private final TokenService tokenService;
  private final TurnstileVerificationService turnstileVerificationService;

  public AuthService(
      AuthProperties authProperties,
      AuthRepository authRepository,
      PasswordEncoder passwordEncoder,
      TokenService tokenService,
      TurnstileVerificationService turnstileVerificationService) {
    this.authProperties = authProperties;
    this.authRepository = authRepository;
    this.passwordEncoder = passwordEncoder;
    this.tokenService = tokenService;
    this.turnstileVerificationService = turnstileVerificationService;
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
}
