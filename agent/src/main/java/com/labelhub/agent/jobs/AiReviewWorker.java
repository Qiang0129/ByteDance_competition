package com.labelhub.agent.jobs;

import com.labelhub.agent.client.BackendClient;
import com.labelhub.agent.config.AgentProperties;
import com.labelhub.agent.llm.ResponsesLlmClient;
import com.labelhub.agent.model.AiReviewCompleteRequest;
import com.labelhub.agent.model.AiReviewJobClaimResponse;
import com.labelhub.agent.model.AiReviewLlmResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class AiReviewWorker {

  private static final Logger log = LoggerFactory.getLogger(AiReviewWorker.class);

  private final BackendClient backendClient;
  private final ResponsesLlmClient llmClient;
  private final AgentProperties properties;

  public AiReviewWorker(
      BackendClient backendClient,
      ResponsesLlmClient llmClient,
      AgentProperties properties) {
    this.backendClient = backendClient;
    this.llmClient = llmClient;
    this.properties = properties;
  }

  @Scheduled(fixedDelayString = "${labelhub.worker.poll-interval-ms:5000}")
  public void pollOnce() {
    if (!properties.getWorker().isEnabled()) {
      return;
    }
    AiReviewJobClaimResponse claimed;
    try {
      claimed = backendClient.claimNext();
    } catch (HttpClientErrorException exception) {
      log.warn("AI review claim failed: status={} body={}", exception.getStatusCode(), exception.getResponseBodyAsString());
      return;
    }
    if (claimed == null || claimed.job() == null) {
      sleepQuietly(properties.getWorker().getIdleDelayMs());
      return;
    }

    String jobId = claimed.job().jobId();
    String runToken = claimed.runToken();
    log.info("AI review job {} claimed for annotation {}", jobId, claimed.annotationId());
    AiReviewLlmResult result;
    try {
      result = llmClient.review(claimed);
    } catch (Exception exception) {
      String summary = "LLM_CALL_FAILED: " + describe(exception);
      log.warn("AI review job {} LLM call failed", jobId, exception);
      reportFailure(jobId, runToken, summary);
      return;
    }

    try {
      backendClient.complete(jobId, new AiReviewCompleteRequest(
          runToken,
          result.scores(),
          result.totalScore(),
          result.decision(),
          result.comment(),
          result.riskFlags(),
          result.evidence(),
          claimed.ruleSnapshot().toString(),
          result.rawResponse(),
          result.modelName(),
          result.latencyMs()));
      log.info("AI review job {} completed with decision {}", jobId, result.decision());
    } catch (Exception exception) {
      String summary = "BACKEND_COMPLETE_FAILED: " + describe(exception);
      if (isStaleRun(exception)) {
        log.warn("AI review job {} complete writeback ignored because run token is stale", jobId);
        return;
      }
      log.warn("AI review job {} backend complete writeback failed", jobId, exception);
      reportFailure(jobId, runToken, summary);
    }
  }

  private void reportFailure(String jobId, String runToken, String summary) {
    try {
      backendClient.fail(jobId, runToken, truncate(summary, 1000));
    } catch (Exception exception) {
      if (isStaleRun(exception)) {
        log.warn("AI review job {} fail writeback ignored because run token is stale", jobId);
        return;
      }
      log.error(
          "AI review job {} failed and backend fail writeback also failed: {}",
          jobId,
          describe(exception),
          exception);
    }
  }

  private String describe(Exception exception) {
    if (exception instanceof RestClientResponseException responseException) {
      String body = responseException.getResponseBodyAsString();
      return responseException.getStatusCode()
          + (body == null || body.isBlank() ? "" : " " + truncate(body, 500));
    }
    String message = exception.getMessage();
    return message == null || message.isBlank()
        ? exception.getClass().getSimpleName()
        : message;
  }

  private boolean isStaleRun(Exception exception) {
    if (exception instanceof RestClientResponseException responseException) {
      return responseException.getStatusCode().value() == 409
          && responseException.getResponseBodyAsString().contains("AI_REVIEW_RUN_STALE");
    }
    return false;
  }

  private void sleepQuietly(long millis) {
    if (millis <= 0) {
      return;
    }
    try {
      Thread.sleep(millis);
    } catch (InterruptedException exception) {
      Thread.currentThread().interrupt();
    }
  }

  private String truncate(String value, int maxLength) {
    if (value == null || value.length() <= maxLength) {
      return value;
    }
    return value.substring(0, maxLength);
  }
}
