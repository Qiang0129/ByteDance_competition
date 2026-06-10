package com.labelhub.backend.auth;

public record PasswordResetCodeRecord(
    long userId,
    String username,
    String email,
    String codeHash,
    int attempts) {}
