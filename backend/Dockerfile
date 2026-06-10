# syntax=docker/dockerfile:1.7

FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY backend/pom.xml backend/pom.xml
RUN --mount=type=cache,target=/root/.m2 cd backend && mvn -B -DskipTests dependency:go-offline

COPY backend/src backend/src
RUN --mount=type=cache,target=/root/.m2 cd backend && mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

RUN apk add --no-cache mysql-client coreutils tzdata \
  && addgroup -S labelhub \
  && adduser -S -G labelhub labelhub \
  && mkdir -p /app/data/exports /app/data/attachments /app/agent/prompts /app/db/migration \
  && chown -R labelhub:labelhub /app

COPY --from=build --chown=labelhub:labelhub /workspace/backend/target/labelhub-backend-*.jar /app/app.jar
COPY --chown=labelhub:labelhub backend/src/main/resources/db/migration /app/db/migration
COPY --chown=labelhub:labelhub agent/prompts /app/agent/prompts

ENV LABELHUB_PROMPTS_DIR=/app/agent/prompts \
    LABELHUB_EXPORT_STORAGE_DIR=/app/data/exports \
    LABELHUB_ATTACHMENTS_STORAGE_DIR=/app/data/attachments \
    TZ=Asia/Shanghai \
    JAVA_TOOL_OPTIONS=-Duser.timezone=Asia/Shanghai

EXPOSE 8080
USER labelhub

ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:-} -jar /app/app.jar"]
