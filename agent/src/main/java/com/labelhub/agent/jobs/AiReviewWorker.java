package com.labelhub.agent.jobs;

import com.labelhub.agent.client.BackendClient;
import com.labelhub.agent.config.AgentProperties;
import com.labelhub.agent.llm.ResponsesLlmClient;
import com.labelhub.agent.model.AiReviewCompleteRequest;
import com.labelhub.agent.model.AiReviewJobClaimResponse;
import com.labelhub.agent.model.AiReviewLlmResult;
import com.labelhub.agent.model.AiModelRuntimeConfig;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientResponseException;

@Component
public class AiReviewWorker implements ApplicationRunner, DisposableBean {

  private static final Logger log = LoggerFactory.getLogger(AiReviewWorker.class);

  private final BackendClient backendClient;
  private final ResponsesLlmClient llmClient;
  private final AgentProperties properties;
  private final AtomicInteger threadSequence = new AtomicInteger(1);
  private volatile boolean running;
  private ExecutorService executorService;

  public AiReviewWorker(
      BackendClient backendClient,
      ResponsesLlmClient llmClient,
      AgentProperties properties) {
    this.backendClient = backendClient;
    this.llmClient = llmClient;
    this.properties = properties;
  }

  @Override
  public void run(ApplicationArguments args) {
    if (!properties.getWorker().isEnabled()) {
      log.info("AI review worker is disabled");
      return;
    }
    int concurrency = resolveWorkerConcurrency();
    running = true;
    executorService = Executors.newFixedThreadPool(concurrency, runnable -> {
      Thread thread = new Thread(runnable, "labelhub-ai-worker-" + threadSequence.getAndIncrement());
      thread.setDaemon(false);
      return thread;
    });
    List<Integer> workerIds = new ArrayList<>();
    for (int workerId = 1; workerId <= concurrency; workerId += 1) {
      int currentWorkerId = workerId;
      workerIds.add(currentWorkerId);
      executorService.submit(() -> workerLoop(currentWorkerId));
    }
    log.info("AI review worker pool started with concurrency={} workers={}", concurrency, workerIds);
  }

  @Override
  public void destroy() throws Exception {
    running = false;
    if (executorService == null) {
      return;
    }
    executorService.shutdownNow();
    if (!executorService.awaitTermination(10, TimeUnit.SECONDS)) {
      log.warn("AI review worker pool did not stop within timeout");
    }
  }

  private void workerLoop(int workerId) {
    while (running && !Thread.currentThread().isInterrupted()) {
      try {
        pollOnce(workerId);
      } catch (Exception exception) {
        log.error("AI review worker {} loop failed: {}", workerId, describe(exception), exception);
        sleepQuietly(properties.getWorker().getPollIntervalMs());
      }
    }
    log.info("AI review worker {} stopped", workerId);
  }

  private void pollOnce(int workerId) {
    AiReviewJobClaimResponse claimed;
    try {
      claimed = backendClient.claimNext();
    } catch (HttpClientErrorException exception) {
      log.warn(
          "AI review worker {} claim failed: status={} body={}",
          workerId,
          exception.getStatusCode(),
          exception.getResponseBodyAsString());
      sleepQuietly(properties.getWorker().getPollIntervalMs());
      return;
    }
    if (claimed == null || claimed.job() == null) {
      sleepQuietly(properties.getWorker().getIdleDelayMs());
      return;
    }

    String jobId = claimed.job().jobId();
    String runToken = claimed.runToken();
    log.info("AI review worker {} claimed job {} for annotation {}", workerId, jobId, claimed.annotationId());
    AiReviewLlmResult result;
    try {
      result = llmClient.review(claimed);
    } catch (Exception exception) {
      String summary = "LLM_CALL_FAILED: " + describe(exception);
      log.warn("AI review worker {} job {} LLM call failed", workerId, jobId, exception);
      reportFailure(workerId, jobId, runToken, summary);
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
      log.info("AI review worker {} completed job {} with decision {}", workerId, jobId, result.decision());
    } catch (Exception exception) {
      String summary = "BACKEND_COMPLETE_FAILED: " + describe(exception);
      if (isStaleRun(exception)) {
        log.warn("AI review worker {} job {} complete writeback ignored because run token is stale", workerId, jobId);
        return;
      }
      log.warn("AI review worker {} job {} backend complete writeback failed", workerId, jobId, exception);
      reportFailure(workerId, jobId, runToken, summary);
    }
  }

  private int resolveWorkerConcurrency() {
    try {
      AiModelRuntimeConfig runtimeConfig = backendClient.getModelRuntimeConfig();
      Integer configured = runtimeConfig == null ? null : runtimeConfig.workerConcurrency();
      if (configured != null) {
        return clampConcurrency(configured);
      }
    } catch (RestClientResponseException exception) {
      if (exception.getStatusCode().value() != 404) {
        log.warn(
            "Backend model runtime config unavailable for worker concurrency: status={} body={}",
            exception.getStatusCode(),
            exception.getResponseBodyAsString());
      }
    } catch (Exception exception) {
      log.warn("Backend model runtime config unavailable for worker concurrency: {}", describe(exception));
    }
    int fallback = clampConcurrency(properties.getWorker().getConcurrency());
    log.info("Using local AI worker concurrency fallback: {}", fallback);
    return fallback;
  }

  private int clampConcurrency(int value) {
    return Math.max(1, Math.min(10, value));
  }

  private void reportFailure(int workerId, String jobId, String runToken, String summary) {
    try {
      backendClient.fail(jobId, runToken, truncate(summary, 1000));
    } catch (Exception exception) {
      if (isStaleRun(exception)) {
        log.warn("AI review worker {} job {} fail writeback ignored because run token is stale", workerId, jobId);
        return;
      }
      log.error(
          "AI review worker {} job {} failed and backend fail writeback also failed: {}",
          workerId,
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
