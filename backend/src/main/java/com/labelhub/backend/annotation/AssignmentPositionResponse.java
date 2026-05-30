package com.labelhub.backend.annotation;

import java.util.List;

/**
 * 当前作业项在批次中的位置信息。
 * assignmentIds 为该任务下当前标注员全部作业项的有序 id 列表,
 * 用于答题页进度条「点击任意题跳转」;index 为 1-based 当前题序。
 * statuses 与 assignmentIds 同序,逐题作答状态用于进度条着色:
 *   "completed" 已提交,或有草稿且必填齐全(绿);
 *   "incomplete" 有草稿但必填缺失(黄);
 *   "empty" 未作答(灰)。
 */
public record AssignmentPositionResponse(
    int index,
    int total,
    String prevAssignmentId,
    String nextAssignmentId,
    List<String> assignmentIds,
    List<String> statuses) {}
