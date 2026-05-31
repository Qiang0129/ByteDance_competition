-- Configure AI Agent worker concurrency on the active model config.

USE labelhub;

ALTER TABLE ai_model_configs
  ADD COLUMN worker_concurrency INT NOT NULL DEFAULT 3 AFTER wire_api;

