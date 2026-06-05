package com.labelhub.backend.auth;

public record CreateReviewerInvitationResponse(
    String token,
    String expiresAt) {}
