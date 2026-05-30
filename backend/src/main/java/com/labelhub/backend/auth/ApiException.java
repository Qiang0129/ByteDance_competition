package com.labelhub.backend.auth;

import org.springframework.http.HttpStatus;

public class ApiException extends RuntimeException {

  private final HttpStatus status;
  private final String code;
  private final Object invalidItems;

  public ApiException(HttpStatus status, String code, String message) {
    this(status, code, message, null);
  }

  public ApiException(HttpStatus status, String code, String message, Object invalidItems) {
    super(message);
    this.status = status;
    this.code = code;
    this.invalidItems = invalidItems;
  }

  public HttpStatus getStatus() {
    return status;
  }

  public String getCode() {
    return code;
  }

  public Object getInvalidItems() {
    return invalidItems;
  }
}
