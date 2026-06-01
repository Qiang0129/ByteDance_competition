package com.labelhub.backend.dashboard;

public record RoleBreakdownResponse(
    String role,
    long memberCount) {}
