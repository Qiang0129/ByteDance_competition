package com.labelhub.backend.auth;

import java.util.List;

public record AuthenticatedUser(
    long id,
    String username,
    String displayName,
    List<String> roles,
    List<String> permissions) {}
