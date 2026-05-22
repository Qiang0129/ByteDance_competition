package com.labelhub.backend.auth;

public record UserAccount(
    long id,
    String username,
    String name,
    String email,
    String passwordHash,
    String status) {}
