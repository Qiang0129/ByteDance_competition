package com.labelhub.backend.task;

public record MarketTaskStatsResponse(
    long availableTasks,
    double avgRewardPerItem,
    long expiringSoonTasks) {}
