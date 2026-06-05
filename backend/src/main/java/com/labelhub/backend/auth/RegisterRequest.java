package com.labelhub.backend.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
    @NotBlank(message = "username is required")
    @Size(max = 64, message = "username is too long")
    String username,
    @NotBlank(message = "password is required")
    @Size(min = 6, max = 72, message = "password length must be 6-72")
    String password,
    String role,
    String inviteToken) {}
