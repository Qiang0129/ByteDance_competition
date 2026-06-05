package com.labelhub.backend.auth;

public record ReviewerInvitationValidationResponse(
    boolean valid,
    String reason,
    String expiresAt) {}
