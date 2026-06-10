package com.labelhub.backend.auth;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetConfirmRequest(
    @NotBlank(message = "username is required")
    @Size(max = 64, message = "username is too long")
    String username,
    @NotBlank(message = "email is required")
    @Email(message = "email format is invalid")
    @Size(max = 255, message = "email is too long")
    String email,
    @NotBlank(message = "verification code is required")
    @Size(min = 6, max = 6, message = "verification code length must be 6")
    String code,
    @NotBlank(message = "new password is required")
    @Size(min = 6, max = 72, message = "password length must be 6-72")
    String newPassword,
    @NotBlank(message = "confirm password is required")
    @Size(min = 6, max = 72, message = "password length must be 6-72")
    String confirmPassword) {}
