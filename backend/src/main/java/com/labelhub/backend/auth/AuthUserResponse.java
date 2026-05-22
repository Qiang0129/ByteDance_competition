package com.labelhub.backend.auth;

import java.util.List;

public record AuthUserResponse(
    String id,
    String username,
    String displayName,
    List<String> roles) {}
