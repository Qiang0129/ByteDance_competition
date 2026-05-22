package com.labelhub.backend.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class TokenAuthenticationFilter extends OncePerRequestFilter {

  private final AuthRepository authRepository;
  private final TokenService tokenService;

  public TokenAuthenticationFilter(AuthRepository authRepository, TokenService tokenService) {
    this.authRepository = authRepository;
    this.tokenService = tokenService;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request,
      HttpServletResponse response,
      FilterChain filterChain) throws ServletException, IOException {
    String authorizationHeader = request.getHeader(HttpHeaders.AUTHORIZATION);

    tokenService.resolve(authorizationHeader).ifPresent(session ->
        authRepository.findUserById(session.userId()).ifPresent(user -> {
          List<String> roles = authRepository.findRoleCodes(user.id());
          List<String> permissions = authRepository.findPermissionCodes(user.id());
          AuthenticatedUser principal = new AuthenticatedUser(
              user.id(),
              user.username(),
              user.name(),
              roles,
              permissions);
          List<SimpleGrantedAuthority> authorities = permissions.stream()
              .map(SimpleGrantedAuthority::new)
              .toList();
          SecurityContextHolder.getContext().setAuthentication(
              new UsernamePasswordAuthenticationToken(principal, session.token(), authorities));
        }));

    try {
      filterChain.doFilter(request, response);
    } finally {
      SecurityContextHolder.clearContext();
    }
  }
}
