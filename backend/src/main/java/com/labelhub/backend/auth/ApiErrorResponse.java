package com.labelhub.backend.auth;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiErrorResponse(
    String code,
    String message,
    Object invalidItems) {

  public ApiErrorResponse(String code, String message) {
    this(code, message, null);
  }
}
