package com.labelhub.backend.auth;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 跨域配置。
 *
 * 背景:开发 / 演示阶段需要用手机等局域网设备访问前端(Vite dev server 默认监听 0.0.0.0:5173)。
 * 前端通过 Vite 的 /api 代理转发到后端,但代理 changeOrigin 只改 Host 头、不改 Origin 头,
 * 因此后端收到的 Origin 仍是手机访问的局域网地址(如 http://192.168.8.171:5173)。
 * 若白名单只放 localhost,局域网 Origin 会被 CorsFilter 直接拒绝并返回 403 Forbidden。
 *
 * 这里用 allowedOriginPatterns(支持通配)放行常见私有网段的 5173 / 4173 端口:
 *   - 192.168.x.x:家用 / 办公路由器最常见网段
 *   - 10.x.x.x:部分企业 / VPN 网段
 *   - 172.16~31.x.x:Docker / 部分企业网段(用 172.{16-31} 粗略覆盖,避免误放公网 172.x)
 * 公网地址不在通配范围内,符合最小必要暴露原则。生产环境应改为精确的前端域名白名单。
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

  private final AuthProperties authProperties;

  public CorsConfig(AuthProperties authProperties) {
    this.authProperties = authProperties;
  }

  @Override
  public void addCorsMappings(CorsRegistry registry) {
    registry.addMapping("/api/**")
        .allowedOriginPatterns(resolveAllowedOriginPatterns())
        .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
        .allowedHeaders("*")
        .allowCredentials(false);
  }

  private String[] resolveAllowedOriginPatterns() {
    String configured = authProperties.getCors() == null
        ? ""
        : authProperties.getCors().getAllowedOriginPatterns();
    if (configured == null || configured.isBlank()) {
      return new String[0];
    }
    return java.util.Arrays.stream(configured.split(","))
        .map(String::trim)
        .filter(pattern -> !pattern.isBlank())
        .toArray(String[]::new);
  }
}
