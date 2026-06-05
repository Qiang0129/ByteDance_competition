package com.labelhub.backend.auth;

import java.time.LocalDateTime;

public record ReviewerInvitationRecord(
    long id,
    String tokenHash,
    long createdBy,
    LocalDateTime expiresAt,
    LocalDateTime usedAt,
    Long usedBy) {}
