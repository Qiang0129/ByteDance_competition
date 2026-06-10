package com.labelhub.backend.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;

@Service
public class PasswordResetMailService {

  private static final Logger LOGGER = LoggerFactory.getLogger(PasswordResetMailService.class);
  private static final String LOGO_CONTENT_ID = "labelhub-logo";
  private static final ClassPathResource LOGO_RESOURCE = new ClassPathResource("mail/labelhub-logo.png");

  private final JavaMailSender mailSender;
  private final AuthProperties authProperties;
  private final String mailUsername;

  public PasswordResetMailService(
      JavaMailSender mailSender,
      AuthProperties authProperties,
      @Value("${spring.mail.username:}") String mailUsername) {
    this.mailSender = mailSender;
    this.authProperties = authProperties;
    this.mailUsername = mailUsername;
  }

  public void sendResetCode(String to, String code, int expiresInMinutes) {
    String from = resolveFromAddress();
    if (from == null) {
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MAIL_UNAVAILABLE", "mail sender is not configured");
    }

    try {
      MimeMessage message = buildResetCodeMessage(from, to, code, expiresInMinutes);
      LOGGER.info("Sending password reset email: domain={}, fromConfigured={}", emailDomain(to), true);
      mailSender.send(message);
      LOGGER.info("Password reset email sent: domain={}", emailDomain(to));
    } catch (MailException | MessagingException exception) {
      LOGGER.warn("Password reset email failed: domain={}, error={}", emailDomain(to), exception.getMessage());
      throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "MAIL_SEND_FAILED", "verification email failed to send");
    }
  }

  private MimeMessage buildResetCodeMessage(
      String from,
      String to,
      String code,
      int expiresInMinutes) throws MessagingException {
    MimeMessage message = mailSender.createMimeMessage();
    MimeMessageHelper helper = new MimeMessageHelper(
        message,
        true,
        StandardCharsets.UTF_8.name());

    helper.setFrom(from);
    helper.setTo(to);
    helper.setSubject("LabelHub 密码重置验证码");
    helper.setText(createPlainText(code, expiresInMinutes), createHtmlText(to, code, expiresInMinutes));
    helper.addInline(LOGO_CONTENT_ID, LOGO_RESOURCE, "image/png");
    return message;
  }

  private String createPlainText(String code, int expiresInMinutes) {
    return """
        你正在重置 LabelHub 账号密码。

        验证码：%s

        验证码 %d 分钟内有效。若不是你本人操作，请忽略此邮件。
        此邮件由系统自动发送，请勿回复。
        """.formatted(code, expiresInMinutes);
  }

  private String createHtmlText(String to, String code, int expiresInMinutes) {
    String escapedEmail = escapeHtml(to);
    String escapedCode = escapeHtml(formatCode(code));
    return """
        <!doctype html>
        <html lang="zh-CN">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>LabelHub 密码重置验证码</title>
          </head>
          <body style="margin:0;padding:0;background:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans SC','Microsoft YaHei',Arial,sans-serif;color:#172033;">
            <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 14px;">
              <tr>
                <td align="center">
                  <table role="presentation" width="100%%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 20px 50px rgba(38,92,170,0.16);">
                    <tr>
                      <td style="height:8px;background:linear-gradient(90deg,#2f7bff,#14b8a6);"></td>
                    </tr>
                    <tr>
                      <td style="padding:42px 36px 36px;text-align:center;">
                        <img src="cid:%s" width="72" height="72" alt="LabelHub" style="display:block;margin:0 auto 24px;border-radius:20px;box-shadow:0 10px 22px rgba(47,123,255,0.22);" />
                        <h1 style="margin:0 0 12px;font-size:28px;line-height:1.35;font-weight:800;color:#111827;">重置您的 LabelHub 密码</h1>
                        <p style="margin:0 auto 26px;max-width:420px;font-size:16px;line-height:1.75;color:#5f6f89;">我们收到了重置密码请求。请在找回密码页面输入以下验证码，完成账号验证。</p>
                        <div style="margin:0 auto 22px;padding:14px 18px;background:#eef6ff;border:1px solid #d6e8ff;border-radius:16px;color:#2764c7;font-size:15px;line-height:1.6;">
                          收件邮箱：<strong style="font-weight:700;color:#1457b8;">%s</strong>
                        </div>
                        <div style="margin:0 auto 26px;padding:22px 18px;background:#f7f8fc;border-radius:18px;border:1px solid #edf0f6;font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace;font-size:42px;line-height:1;font-weight:800;letter-spacing:10px;color:#202333;">%s</div>
                        <p style="margin:0 0 10px;font-size:15px;line-height:1.7;color:#6b7280;">此验证码将在 <strong style="color:#111827;">%d 分钟</strong> 内有效。</p>
                        <p style="margin:0;font-size:14px;line-height:1.75;color:#8a96a8;">如果不是您本人操作，可以安全忽略此邮件。</p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #edf1f7;text-align:center;font-size:12px;line-height:1.6;color:#9aa6b6;">
                        LabelHub 数据标注平台 · 此邮件由系统自动发送，请勿回复
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
        """.formatted(LOGO_CONTENT_ID, escapedEmail, escapedCode, expiresInMinutes);
  }

  private String formatCode(String code) {
    return code == null ? "" : String.join(" ", code.trim().split(""));
  }

  private String escapeHtml(String value) {
    if (value == null || value.isBlank()) {
      return "";
    }
    return value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
        .replace("'", "&#39;");
  }

  private String resolveFromAddress() {
    String configuredFrom = authProperties.getPasswordReset().getMailFrom();
    if (configuredFrom != null && !configuredFrom.isBlank()) {
      return configuredFrom.trim();
    }
    if (mailUsername != null && !mailUsername.isBlank()) {
      return mailUsername.trim();
    }
    return null;
  }

  private String emailDomain(String email) {
    if (email == null || email.isBlank()) {
      return "blank";
    }
    int atIndex = email.lastIndexOf('@');
    if (atIndex < 0 || atIndex == email.length() - 1) {
      return "invalid";
    }
    return email.substring(atIndex + 1);
  }
}
