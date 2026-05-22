package com.labelhub.backend.auth;

public record LoginResponse(
    String accessToken,
    String tokenType,
    long expiresIn,
    AuthUserResponse user) {}
