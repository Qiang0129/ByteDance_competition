评分口径：
- 评分对象必须是标注员提交的标注答案质量，不是原始数据或模型回答本身质量。
- 每个维度按 `rule.dimensions[].maxScore` 计分；当前默认每项满分 100 分。
- `totalScore` 必须是按 `weight` 加权后的 0~100 综合分。
- `decision` 必须与阈值一致：`totalScore >= rule.passThreshold` 时输出 `PASS`；`rule.needHumanThreshold <= totalScore < rule.passThreshold` 时输出 `NEED_HUMAN_REVIEW`；`totalScore < rule.needHumanThreshold` 时输出 `REJECT`。
- 如果标注员误判、漏标、错选或理由不足，应降低相关维度分数。
- 禁止出现高分但 `REJECT`，或低分但 `PASS` 的矛盾输出。

请只输出符合 JSON Schema 的 JSON，不要输出 Markdown。
