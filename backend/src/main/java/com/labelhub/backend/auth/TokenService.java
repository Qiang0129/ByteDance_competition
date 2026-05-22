package com.labelhub.backend.auth;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class TokenService {

  private static final int TOKEN_BYTES = 32;
  private static final String TOKEN_PREFIX = "labelhub:auth:session:";

  private final SecureRandom secureRandom = new SecureRandom();
  private final AuthProperties authProperties;
  private final StringRedisTemplate redisTemplate;

  public TokenService(AuthProperties authProperties, StringRedisTemplate redisTemplate) {
    this.authProperties = authProperties;
    this.redisTemplate = redisTemplate;
  }

  public SessionPrincipal issueToken(long userId) {
    byte[] randomBytes = new byte[TOKEN_BYTES];
    secureRandom.nextBytes(randomBytes);
    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(randomBytes);
    Instant expiresAt = Instant.now().plusSeconds(authProperties.getTokenTtlSeconds());
    SessionPrincipal principal = new SessionPrincipal(token, userId, expiresAt);
    redisTemplate.opsForValue().set(
        buildTokenKey(token),
        Long.toString(userId),
        java.time.Duration.ofSeconds(authProperties.getTokenTtlSeconds()));
    return principal;
  }

  public Optional<SessionPrincipal> resolve(String authorizationHeader) {
    String token = extractBearerToken(authorizationHeader);
    if (token == null) {
      return Optional.empty();
    }

    String userIdValue = redisTemplate.opsForValue().get(buildTokenKey(token));
    if (userIdValue == null || userIdValue.isBlank()) {
      return Optional.empty();
    }

    try {
      return Optional.of(new SessionPrincipal(
          token,
          Long.parseLong(userIdValue),
          Instant.now().plusSeconds(authProperties.getTokenTtlSeconds())));
    } catch (NumberFormatException exception) {
      redisTemplate.delete(buildTokenKey(token));
      return Optional.empty();
    }
  }

  public void revoke(String authorizationHeader) {
    String token = extractBearerToken(authorizationHeader);
    if (token != null) {
      redisTemplate.delete(buildTokenKey(token));
    }
  }

  public String extractBearerToken(String authorizationHeader) {
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

  private String buildTokenKey(String token) {
    return TOKEN_PREFIX + token;
  }
}
