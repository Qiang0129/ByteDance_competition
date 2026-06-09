# syntax=docker/dockerfile:1.7

FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace

COPY agent/pom.xml agent/pom.xml
RUN --mount=type=cache,target=/root/.m2 cd agent && mvn -B -DskipTests dependency:go-offline

COPY agent/src agent/src
RUN --mount=type=cache,target=/root/.m2 cd agent && mvn -B -DskipTests package

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

RUN addgroup -S labelhub \
  && adduser -S -G labelhub labelhub \
  && mkdir -p /app/agent/prompts \
  && chown -R labelhub:labelhub /app

COPY --from=build --chown=labelhub:labelhub /workspace/agent/target/labelhub-agent-*.jar /app/app.jar
COPY --chown=labelhub:labelhub agent/prompts /app/agent/prompts

ENV LABELHUB_PROMPTS_DIR=/app/agent/prompts

EXPOSE 8091
USER labelhub

ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:-} -jar /app/app.jar"]
