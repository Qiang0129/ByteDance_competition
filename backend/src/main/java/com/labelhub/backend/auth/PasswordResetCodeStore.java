package com.labelhub.backend.auth;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class PasswordResetCodeStore {

  private static final String CODE_PREFIX = "labelhub:auth:password-reset:code:";
  private static final String COOLDOWN_PREFIX = "labelhub:auth:password-reset:cooldown:";

  private final StringRedisTemplate redisTemplate;
  private final ObjectMapper objectMapper;

  public PasswordResetCodeStore(StringRedisTemplate redisTemplate, ObjectMapper objectMapper) {
    this.redisTemplate = redisTemplate;
    this.objectMapper = objectMapper;
  }

  public boolean isInCooldown(String username) {
    return Boolean.TRUE.equals(redisTemplate.hasKey(cooldownKey(username)));
  }

  public void save(PasswordResetCodeRecord record, Duration ttl, Duration cooldown) {
    try {
      redisTemplate.opsForValue().set(codeKey(record.username()), objectMapper.writeValueAsString(record), ttl);
      redisTemplate.opsForValue().set(cooldownKey(record.username()), "1", cooldown);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to store password reset code", exception);
    }
  }

  public Optional<PasswordResetCodeRecord> find(String username) {
    String json = redisTemplate.opsForValue().get(codeKey(username));
    if (json == null || json.isBlank()) {
      return Optional.empty();
    }
    try {
      return Optional.of(objectMapper.readValue(json, PasswordResetCodeRecord.class));
    } catch (JsonProcessingException exception) {
      redisTemplate.delete(codeKey(username));
      return Optional.empty();
    }
  }

  public void updateAttempts(PasswordResetCodeRecord record) {
    Long ttlSeconds = redisTemplate.getExpire(codeKey(record.username()));
    if (ttlSeconds == null || ttlSeconds <= 0) {
      return;
    }
    try {
      redisTemplate.opsForValue().set(
          codeKey(record.username()),
          objectMapper.writeValueAsString(record),
          Duration.ofSeconds(ttlSeconds));
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("failed to update password reset attempts", exception);
    }
  }

  public void delete(String username) {
    redisTemplate.delete(codeKey(username));
    redisTemplate.delete(cooldownKey(username));
  }

  private String codeKey(String username) {
    return CODE_PREFIX + username;
  }

  private String cooldownKey(String username) {
    return COOLDOWN_PREFIX + username;
  }
}
