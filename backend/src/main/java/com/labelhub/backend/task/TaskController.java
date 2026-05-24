package com.labelhub.backend.task;

import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
public class TaskController {

  private final TaskService taskService;

  public TaskController(TaskService taskService) {
    this.taskService = taskService;
  }

  @PostMapping("/tasks")
  public OwnerTaskResponse createTask(
      Authentication authentication,
      @Valid @RequestBody CreateTaskRequest request) {
    return taskService.createTask(authentication, request);
  }

  @GetMapping("/tasks")
  public PageResponse<OwnerTaskResponse> listOwnerTasks(Authentication authentication) {
    return taskService.listOwnerTasks(authentication);
  }

  @PutMapping("/tasks/{taskId}/state")
  public OwnerTaskResponse updateTaskState(
      Authentication authentication,
      @PathVariable long taskId,
      @Valid @RequestBody UpdateTaskStateRequest request) {
    return taskService.updateState(authentication, taskId, request);
  }

  @GetMapping("/market/tasks")
  public PageResponse<MarketTaskResponse> listMarketTasks(
      Authentication authentication,
      @RequestParam(required = false) String keyword,
      @RequestParam(required = false) String taskType,
      @RequestParam(required = false) Integer page,
      @RequestParam(required = false) Integer pageSize) {
    return taskService.listMarketTasks(authentication, keyword, taskType, page, pageSize);
  }
}
