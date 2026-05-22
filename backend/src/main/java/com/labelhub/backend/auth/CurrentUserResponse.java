package com.labelhub.backend.auth;

import java.util.List;

public record CurrentUserResponse(
    AuthUserResponse user,
    List<String> permissions) {}
