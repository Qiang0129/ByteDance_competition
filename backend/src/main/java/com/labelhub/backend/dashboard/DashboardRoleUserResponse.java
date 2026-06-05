package com.labelhub.backend.dashboard;

import java.util.List;

public record DashboardRoleUserResponse(
    String id,
    String username,
    String name,
    String status,
    List<String> roles) {}
