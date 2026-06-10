package com.labelhub.backend.auth;

public record PasswordResetCodeResponse(
    String message,
    int expiresInSeconds,
    int resendCooldownSeconds) {}
