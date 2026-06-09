package com.labelhub.backend.auth;

public record CreateOwnerInvitationResponse(
    String token,
    String expiresAt) {}
