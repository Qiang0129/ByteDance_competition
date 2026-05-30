package com.labelhub.backend.ai;

import com.labelhub.backend.auth.ApiException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class AiModelConfigCrypto {

  private static final String PREFIX = "v1";
  private static final int GCM_TAG_BITS = 128;
  private static final int IV_BYTES = 12;

  private final AiModelConfigProperties properties;
  private final SecureRandom secureRandom = new SecureRandom();

  public AiModelConfigCrypto(AiModelConfigProperties properties) {
    this.properties = properties;
  }

  public String encrypt(String plaintext) {
    ensureSecretConfigured();
    try {
      byte[] iv = new byte[IV_BYTES];
      secureRandom.nextBytes(iv);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, keySpec(), new GCMParameterSpec(GCM_TAG_BITS, iv));
      byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
      return PREFIX + ":"
          + Base64.getEncoder().encodeToString(iv)
          + ":"
          + Base64.getEncoder().encodeToString(encrypted);
    } catch (Exception exception) {
      throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          "AI_MODEL_KEY_ENCRYPT_FAILED",
          "api key encryption failed");
    }
  }

  public String decrypt(String encryptedValue) {
    ensureSecretConfigured();
    try {
      String[] parts = encryptedValue == null ? new String[0] : encryptedValue.split(":", 3);
      if (parts.length != 3 || !PREFIX.equals(parts[0])) {
        throw new IllegalArgumentException("unsupported encrypted api key format");
      }
      byte[] iv = Base64.getDecoder().decode(parts[1]);
      byte[] encrypted = Base64.getDecoder().decode(parts[2]);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, keySpec(), new GCMParameterSpec(GCM_TAG_BITS, iv));
      return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    } catch (ApiException exception) {
      throw exception;
    } catch (Exception exception) {
      throw new ApiException(
          HttpStatus.INTERNAL_SERVER_ERROR,
          "AI_MODEL_KEY_DECRYPT_FAILED",
          "api key decryption failed");
    }
  }

  public void ensureSecretConfigured() {
    if (properties.getSecret() == null || properties.getSecret().isBlank()) {
      throw new ApiException(
          HttpStatus.CONFLICT,
          "AI_MODEL_CONFIG_SECRET_REQUIRED",
          "LABELHUB_MODEL_CONFIG_SECRET is required to store or read api keys");
    }
  }

  private SecretKeySpec keySpec() throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] key = digest.digest(properties.getSecret().getBytes(StandardCharsets.UTF_8));
    return new SecretKeySpec(key, "AES");
  }
}
