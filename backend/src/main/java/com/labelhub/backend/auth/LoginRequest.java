package com.labelhub.backend.auth;

import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
    @NotBlank(message = "username is required") String username,
    @NotBlank(message = "password is required") String password,
    String role,
    String turnstileToken) {}
