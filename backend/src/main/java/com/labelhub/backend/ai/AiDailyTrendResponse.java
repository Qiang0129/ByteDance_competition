package com.labelhub.backend.ai;

public record AiDailyTrendResponse(
    String date,
    long total,
    long pass,
    long needHuman,
    long reject) {}
