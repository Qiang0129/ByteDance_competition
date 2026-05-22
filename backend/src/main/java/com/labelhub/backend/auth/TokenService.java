package com.labelhub.backend.auth;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

@Service
public class TokenService {

  private static final int TOKEN_BYTES = 32;

  private final SecureRandom secureRandom = new SecureRandom();
  private final Map<String, SessionPrincipal> sessions = new ConcurrentHashMap<>();
  private final AuthProperties authProperties;

  public TokenService(AuthProperties authProperties) {
    this.authProperties = authProperties;
  }

  public SessionPrincipal issueToken(long userId) {
    byte[] randomBytes = new byte[TOKEN_BYTES];
    secureRandom.nextBytes(randomBytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    Instant expiresAt = Instant.now().plusSeconds(authProperties.getTokenTtlSeconds());
    SessionPrincipal principal = new SessionPrincipal(token, userId, expiresAt);
    sessions.put(token, principal);
    return principal;
  }

  public Optional<SessionPrincipal> resolve(String authorizationHeader) {
    String token = extractBearerToken(authorizationHeader);
    if (token == null) {
      return Optional.empty();
    }

    SessionPrincipal principal = sessions.get(token);
    if (principal == null) {
      return Optional.empty();
    }
    if (principal.expiresAt().isBefore(Instant.now())) {
      sessions.remove(token);
      return Optional.empty();
    }

    return Optional.of(principal);
  }

  public void revoke(String authorizationHeader) {
    String token = extractBearerToken(authorizationHeader);
    if (token != null) {
      sessions.remove(token);
    }
  }

  private String extractBearerToken(String authorizationHeader) {
    if (authorizationHeader == null || authorizationHeader.isBlank()) {
      return null;
    }

    String prefix = "Bearer ";
    if (!authorizationHeader.regionMatches(true, 0, prefix, 0, prefix.length())) {
      return null;
    }

    String token = authorizationHeader.substring(prefix.length()).trim();
    return token.isEmpty() ? null : token;
  }
}
