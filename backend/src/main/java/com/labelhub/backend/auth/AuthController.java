package com.labelhub.backend.auth;

import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

  private final AuthService authService;

  public AuthController(AuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/login")
  public LoginResponse login(@Valid @RequestBody LoginRequest request) {
    return authService.login(request);
  }

  @PostMapping("/register")
  public AuthUserResponse register(@Valid @RequestBody RegisterRequest request) {
    return authService.register(request);
  }

  @PostMapping("/reviewer-invitations")
  public CreateReviewerInvitationResponse createReviewerInvitation(Authentication authentication) {
    return authService.createReviewerInvitation(authentication);
  }

  @GetMapping("/reviewer-invitations/validate")
  public ReviewerInvitationValidationResponse validateReviewerInvitation(@RequestParam String token) {
    return authService.validateReviewerInvitation(token);
  }

  @PostMapping("/logout")
  public ResponseEntity<Void> logout(
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorizationHeader) {
    authService.logout(authorizationHeader);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/me")
  public CurrentUserResponse me(Authentication authentication) {
    return authService.getCurrentUser(authentication);
  }
}
