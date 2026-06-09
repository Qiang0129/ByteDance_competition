package com.labelhub.backend.auth;

import java.time.LocalDateTime;

public record OwnerInvitationRecord(
    long id,
    String tokenHash,
    long createdBy,
    LocalDateTime expiresAt,
    LocalDateTime usedAt,
    Long usedBy) {}
