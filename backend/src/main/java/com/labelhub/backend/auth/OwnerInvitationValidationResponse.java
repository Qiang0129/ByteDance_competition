package com.labelhub.backend.auth;

public record OwnerInvitationValidationResponse(
    boolean valid,
    String reason,
    String expiresAt) {}
