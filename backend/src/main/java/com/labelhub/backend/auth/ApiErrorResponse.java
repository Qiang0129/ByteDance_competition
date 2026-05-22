package com.labelhub.backend.auth;

public record ApiErrorResponse(
    String code,
    String message) {}
