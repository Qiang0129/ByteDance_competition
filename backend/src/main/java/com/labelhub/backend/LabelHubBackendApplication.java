package com.labelhub.backend;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class LabelHubBackendApplication {

  public static void main(String[] args) {
    SpringApplication.run(LabelHubBackendApplication.class, args);
  }
}
