-- Allow datasets and imported items to exist before being bound to a task.

USE labelhub;

ALTER TABLE items DROP FOREIGN KEY fk_items_task;
ALTER TABLE datasets DROP FOREIGN KEY fk_datasets_task;

ALTER TABLE datasets
  MODIFY COLUMN task_id BIGINT UNSIGNED DEFAULT NULL;

ALTER TABLE items
  MODIFY COLUMN task_id BIGINT UNSIGNED DEFAULT NULL;

ALTER TABLE datasets
  ADD CONSTRAINT fk_datasets_task
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL;

ALTER TABLE items
  ADD CONSTRAINT fk_items_task
  FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL;
