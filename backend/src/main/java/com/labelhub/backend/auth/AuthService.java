package com.labelhub.backend.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Base64;
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
  private static final SecureRandom SECURE_RANDOM = new SecureRandom();

  private final AuthProperties authProperties;
  private final AuthRepository authRepository;
  private final PasswordEncoder passwordEncoder;
  private final TokenService tokenService;

  public AuthService(
      AuthProperties authProperties,
      AuthRepository authRepository,
      PasswordEncoder passwordEncoder,
      TokenService tokenService) {
    this.authProperties = authProperties;
    this.authRepository = authRepository;
    this.passwordEncoder = passwordEncoder;
    this.tokenService = tokenService;
  }

  public LoginResponse login(LoginRequest request) {
    String requestedRole = normalizeRole(request.role());
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
    String username = request.username().trim();
    String inviteToken = normalizeInviteToken(request.inviteToken());
    ReviewerInvitationRecord invitation = null;
    String role = "labeler";

    if (authRepository.usernameExists(username)) {
      throw new ApiException(HttpStatus.CONFLICT, "USERNAME_EXISTS", "username already exists");
    }

    if (inviteToken != null) {
      invitation = requireUsableReviewerInvitation(inviteToken);
      role = "reviewer";
    }

    UserAccount user = authRepository.createUser(
        username,
        username,
        passwordEncoder.encode(request.password()),
        role);
    if (invitation != null) {
      int marked = authRepository.markReviewerInvitationUsed(invitation.id(), user.id());
      if (marked == 0) {
        throw new ApiException(HttpStatus.CONFLICT, "INVITATION_USED", "invitation has already been used");
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

  public ReviewerInvitationValidationResponse validateReviewerInvitation(String token) {
    String inviteToken = normalizeInviteToken(token);
    if (inviteToken == null) {
      return new ReviewerInvitationValidationResponse(false, "invalid", null);
    }
    return authRepository.findReviewerInvitationByTokenHash(hashToken(inviteToken))
        .map(this::toInvitationValidationResponse)
        .orElseGet(() -> new ReviewerInvitationValidationResponse(false, "invalid", null));
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

  private ReviewerInvitationValidationResponse toInvitationValidationResponse(ReviewerInvitationRecord invitation) {
    if (invitation.usedAt() != null) {
      return new ReviewerInvitationValidationResponse(false, "used", formatDateTime(invitation.expiresAt()));
    }
    if (invitation.expiresAt().isBefore(LocalDateTime.now())) {
      return new ReviewerInvitationValidationResponse(false, "expired", formatDateTime(invitation.expiresAt()));
    }
    return new ReviewerInvitationValidationResponse(true, null, formatDateTime(invitation.expiresAt()));
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
