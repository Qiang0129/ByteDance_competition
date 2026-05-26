package com.labelhub.backend.dataset;

import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class DatasetRepository {

  private final JdbcTemplate jdbcTemplate;

  public DatasetRepository(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public boolean taskBelongsToOwner(long taskId, long ownerId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tasks WHERE id = ? AND owner_id = ?",
        Integer.class,
        taskId,
        ownerId);
    return count != null && count > 0;
  }

  public long createFile(
      long ownerId,
      String storageKey,
      String filename,
      String mimeType,
      Long size,
      String checksum) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO files (storage_key, filename, mime_type, size, checksum, created_by)
          VALUES (?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      statement.setString(1, storageKey);
      statement.setString(2, filename);
      statement.setString(3, mimeType);
      if (size == null) {
        statement.setNull(4, Types.BIGINT);
      } else {
        statement.setLong(4, size);
      }
      statement.setString(5, checksum);
      statement.setLong(6, ownerId);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create file record");
    }
    return key.longValue();
  }

  public long createDataset(
      Long taskId,
      long fileId,
      String datasetType,
      String importStatus,
      int totalCount,
      int successCount,
      int errorCount,
      String errorSummary) {
    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbcTemplate.update(connection -> {
      var statement = connection.prepareStatement(
          """
          INSERT INTO datasets
            (task_id, file_id, dataset_type, import_status, total_count, success_count, error_count, error_summary)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          """,
          Statement.RETURN_GENERATED_KEYS);
      if (taskId == null) {
        statement.setNull(1, Types.BIGINT);
      } else {
        statement.setLong(1, taskId);
      }
      statement.setLong(2, fileId);
      statement.setString(3, datasetType);
      statement.setString(4, importStatus);
      statement.setInt(5, totalCount);
      statement.setInt(6, successCount);
      statement.setInt(7, errorCount);
      statement.setString(8, errorSummary);
      return statement;
    }, keyHolder);
    Number key = keyHolder.getKey();
    if (key == null) {
      throw new IllegalStateException("failed to create dataset");
    }
    return key.longValue();
  }

  public List<DatasetRecord> listOwnerDatasets(long ownerId) {
    return queryDatasets(
        """
        WHERE f.created_by = ?
        """,
        List.of(ownerId),
        "ORDER BY d.created_at DESC");
  }

  public Optional<DatasetRecord> findOwnerDataset(long ownerId, long datasetId) {
    return queryDatasets(
        """
        WHERE f.created_by = ? AND d.id = ?
        """,
        List.of(ownerId, datasetId),
        "").stream().findFirst();
  }

  public Map<String, Integer> countMediaDistribution(long datasetId) {
    return jdbcTemplate.query(
            """
            SELECT COALESCE(NULLIF(media_type, ''), 'text') AS media_type, COUNT(*) AS count
            FROM items
            WHERE dataset_id = ?
            GROUP BY COALESCE(NULLIF(media_type, ''), 'text')
            """,
            (rs, rowNum) -> Map.entry(rs.getString("media_type"), rs.getInt("count")),
            datasetId)
        .stream()
        .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
  }

  public List<String> listItemRawPayloads(long ownerId, long datasetId) {
    return jdbcTemplate.query(
        """
        SELECT CAST(i.raw_payload AS CHAR) AS raw_payload_json
        FROM items i
        JOIN datasets d ON d.id = i.dataset_id
        LEFT JOIN files f ON f.id = d.file_id
        WHERE f.created_by = ? AND d.id = ?
        ORDER BY i.id ASC
        """,
        (rs, rowNum) -> rs.getString("raw_payload_json"),
        ownerId,
        datasetId);
  }

  public void insertItems(Long taskId, long datasetId, List<DatasetItemPayload> items) {
    if (items.isEmpty()) {
      return;
    }
    jdbcTemplate.batchUpdate(
        """
        INSERT INTO items
          (task_id, dataset_id, item_key, raw_payload, media_type, media_url, content_markdown, item_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
        """,
        new BatchPreparedStatementSetter() {
          @Override
          public void setValues(java.sql.PreparedStatement ps, int i) throws java.sql.SQLException {
            DatasetItemPayload item = items.get(i);
            if (taskId == null) {
              ps.setNull(1, Types.BIGINT);
            } else {
              ps.setLong(1, taskId);
            }
            ps.setLong(2, datasetId);
            ps.setString(3, item.itemKey());
            ps.setString(4, item.rawPayloadJson());
            ps.setString(5, item.mediaType());
            ps.setString(6, item.mediaUrl());
            ps.setString(7, item.contentMarkdown());
          }

          @Override
          public int getBatchSize() {
            return items.size();
          }
        });
  }

  public void addDatasetImportCounts(long datasetId, int addedCount, long addedBytes) {
    jdbcTemplate.update(
        """
        UPDATE datasets
        SET total_count = total_count + ?,
            success_count = success_count + ?,
            import_status = 'imported',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        addedCount,
        addedCount,
        datasetId);
    jdbcTemplate.update(
        """
        UPDATE files f
        JOIN datasets d ON d.file_id = f.id
        SET f.size = COALESCE(f.size, 0) + ?
        WHERE d.id = ?
        """,
        addedBytes,
        datasetId);
  }

  public void rebindDatasetToTask(long datasetId, long taskId) {
    jdbcTemplate.update(
        """
        UPDATE datasets
        SET task_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        taskId,
        datasetId);
    jdbcTemplate.update(
        """
        UPDATE items
        SET task_id = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE dataset_id = ?
        """,
        taskId,
        datasetId);
  }

  private List<DatasetRecord> queryDatasets(String whereClause, List<Object> args, String suffix) {
    String sql = """
        SELECT
          d.id,
          d.task_id,
          t.title AS task_title,
          d.file_id,
          f.filename AS file_name,
          f.size AS file_size,
          d.dataset_type,
          d.import_status,
          d.total_count,
          d.success_count,
          d.error_count,
          d.error_summary,
          d.created_at,
          d.updated_at
        FROM datasets d
        LEFT JOIN tasks t ON t.id = d.task_id
        LEFT JOIN files f ON f.id = d.file_id
        """ + whereClause + " " + suffix;

    return jdbcTemplate.query(
        sql,
        (rs, rowNum) -> new DatasetRecord(
            rs.getLong("id"),
            toLong(rs.getObject("task_id")),
            rs.getString("task_title"),
            toLong(rs.getObject("file_id")),
            rs.getString("file_name"),
            toLong(rs.getObject("file_size")),
            rs.getString("dataset_type"),
            rs.getString("import_status"),
            rs.getInt("total_count"),
            rs.getInt("success_count"),
            rs.getInt("error_count"),
            rs.getString("error_summary"),
            toLocalDateTime(rs.getTimestamp("created_at")),
            toLocalDateTime(rs.getTimestamp("updated_at"))),
        args.toArray());
  }

  private LocalDateTime toLocalDateTime(Timestamp timestamp) {
    return timestamp == null ? null : timestamp.toLocalDateTime();
  }

  private Long toLong(Object value) {
    return value == null ? null : ((Number) value).longValue();
  }
}
