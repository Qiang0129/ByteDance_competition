package com.labelhub.backend.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetCodeRequest(
    @NotBlank(message = "username is required")
    @Size(max = 64, message = "username is too long")
    String username,
    @NotBlank(message = "email is required")
    @Email(message = "email format is invalid")
    @Size(max = 255, message = "email is too long")
    String email,
    String turnstileToken) {}
