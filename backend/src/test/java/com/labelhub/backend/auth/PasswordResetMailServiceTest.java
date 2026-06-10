package com.labelhub.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import jakarta.mail.BodyPart;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;

@ExtendWith(MockitoExtension.class)
class PasswordResetMailServiceTest {

  @Mock
  private JavaMailSender mailSender;

  private AuthProperties authProperties;
  private PasswordResetMailService service;

  @BeforeEach
  void setUp() {
    authProperties = new AuthProperties();
    authProperties.getPasswordReset().setMailFrom("noreply@labelhub.test");
    service = new PasswordResetMailService(mailSender, authProperties, "smtp-user@labelhub.test");
  }

  @Test
  void sendsHtmlPasswordResetEmailWithInlineLogoAndPlainTextFallback() throws Exception {
    when(mailSender.createMimeMessage()).thenReturn(newMimeMessage());

    service.sendResetCode("reviewer&team@example.com", "832979", 5);

    MimeMessage message = captureSentMessage();
    List<String> textParts = collectTextParts(message);

    assertThat(message.getSubject()).isEqualTo("LabelHub 密码重置验证码");
    assertThat(message.getFrom()[0].toString()).isEqualTo("noreply@labelhub.test");
    assertThat(textParts).anySatisfy(text -> {
      assertThat(text).contains("你正在重置 LabelHub 账号密码。");
      assertThat(text).contains("验证码：832979");
      assertThat(text).contains("验证码 5 分钟内有效");
    });
    assertThat(textParts).anySatisfy(html -> {
      assertThat(html).contains("<title>LabelHub 密码重置验证码</title>");
      assertThat(html).contains("重置您的 LabelHub 密码");
      assertThat(html).contains("reviewer&amp;team@example.com");
      assertThat(html).contains("8 3 2 9 7 9");
      assertThat(html).contains("cid:labelhub-logo");
    });
    assertThat(containsInlineLogo(message)).isTrue();
  }

  @Test
  void fallsBackToMailUsernameWhenMailFromIsBlank() throws Exception {
    authProperties.getPasswordReset().setMailFrom("");
    when(mailSender.createMimeMessage()).thenReturn(newMimeMessage());

    service.sendResetCode("reviewer@example.com", "123456", 10);

    assertThat(captureSentMessage().getFrom()[0].toString()).isEqualTo("smtp-user@labelhub.test");
  }

  @Test
  void reportsUnavailableWhenSenderAddressIsMissing() {
    authProperties.getPasswordReset().setMailFrom("");
    service = new PasswordResetMailService(mailSender, authProperties, "");

    assertThatThrownBy(() -> service.sendResetCode("reviewer@example.com", "123456", 10))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("MAIL_UNAVAILABLE");
  }

  @Test
  void convertsMailSendFailureToApiException() {
    when(mailSender.createMimeMessage()).thenReturn(newMimeMessage());
    doThrow(new MailSendException("smtp failed")).when(mailSender).send(any(MimeMessage.class));

    assertThatThrownBy(() -> service.sendResetCode("reviewer@example.com", "123456", 10))
        .isInstanceOf(ApiException.class)
        .extracting(error -> ((ApiException) error).getCode())
        .isEqualTo("MAIL_SEND_FAILED");
  }

  private MimeMessage captureSentMessage() throws MessagingException {
    ArgumentCaptor<MimeMessage> captor = ArgumentCaptor.forClass(MimeMessage.class);
    verify(mailSender).send(captor.capture());
    MimeMessage message = captor.getValue();
    message.saveChanges();
    return message;
  }

  private MimeMessage newMimeMessage() {
    return new MimeMessage(Session.getInstance(new Properties()));
  }

  private List<String> collectTextParts(Part part) throws MessagingException, IOException {
    List<String> parts = new ArrayList<>();
    collectTextParts(part, parts);
    return parts;
  }

  private void collectTextParts(Part part, List<String> parts) throws MessagingException, IOException {
    if (part.isMimeType("multipart/*")) {
      Multipart multipart = (Multipart) part.getContent();
      for (int i = 0; i < multipart.getCount(); i += 1) {
        collectTextParts(multipart.getBodyPart(i), parts);
      }
      return;
    }

    Object content = part.getContent();
    if ((part.isMimeType("text/plain") || part.isMimeType("text/html")) && content instanceof String text) {
      parts.add(text);
    }
  }

  private boolean containsInlineLogo(Part part) throws MessagingException, IOException {
    if (part.isMimeType("multipart/*")) {
      Multipart multipart = (Multipart) part.getContent();
      for (int i = 0; i < multipart.getCount(); i += 1) {
        if (containsInlineLogo(multipart.getBodyPart(i))) {
          return true;
        }
      }
      return false;
    }

    if (!(part instanceof BodyPart bodyPart)) {
      return false;
    }
    String[] contentIdHeaders = bodyPart.getHeader("Content-ID");
    String contentId = contentIdHeaders == null ? null : String.join(",", contentIdHeaders);
    return Part.INLINE.equalsIgnoreCase(bodyPart.getDisposition())
        && contentId != null
        && contentId.contains("labelhub-logo")
        && bodyPart.isMimeType("image/png");
  }
}
