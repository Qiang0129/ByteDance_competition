package com.labelhub.backend.auth;

import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

  private static final List<String> LOGIN_ROLES =
      List.of("owner", "labeler", "reviewer", "ai_reviewer", "system_agent");

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

  public AuthUserResponse register(RegisterRequest request) {
    String username = request.username().trim();
    String role = normalizeRegisterRole(request.role());

    if (authRepository.usernameExists(username)) {
      throw new ApiException(HttpStatus.CONFLICT, "USERNAME_EXISTS", "username already exists");
    }

    UserAccount user = authRepository.createUser(
        username,
        username,
        passwordEncoder.encode(request.password()),
        role);
    return toAuthUser(user, authRepository.findRoleCodes(user.id()));
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

  private String normalizeRegisterRole(String role) {
    if (role == null || role.isBlank()) {
      return "labeler";
    }
    return normalizeRole(role);
  }

  private AuthenticatedUser requirePrincipal(Authentication authentication) {
    if (authentication == null || !(authentication.getPrincipal() instanceof AuthenticatedUser principal)) {
      throw unauthorized("missing or invalid token");
    }
    return principal;
  }

  private ApiException unauthorized(String message) {
    return new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", message);
  }
}
