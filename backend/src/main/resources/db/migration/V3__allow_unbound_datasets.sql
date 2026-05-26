-- Allow Owner to create/import datasets before binding them to a task.
-- Existing databases initialized from V1 need this manual migration.

USE labelhub;

ALTER TABLE items DROP FOREIGN KEY fk_items_task;
ALTER TABLE datasets DROP FOREIGN KEY fk_datasets_task;

ALTER TABLE datasets
  MODIFY task_id BIGINT UNSIGNED DEFAULT NULL;

ALTER TABLE items
  MODIFY task_id BIGINT UNSIGNED DEFAULT NULL;

ALTER TABLE datasets
  ADD CONSTRAINT fk_datasets_task
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL;

ALTER TABLE items
  ADD CONSTRAINT fk_items_task
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL;
