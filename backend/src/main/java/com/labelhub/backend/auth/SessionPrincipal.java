package com.labelhub.backend.auth;

import java.time.Instant;

public record SessionPrincipal(
    String token,
    long userId,
    Instant expiresAt) {}
