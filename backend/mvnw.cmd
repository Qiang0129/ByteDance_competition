@echo off
setlocal

chcp 65001 >nul
set MAVEN_OPTS=-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 %MAVEN_OPTS%

set MAVEN_VERSION=3.9.9
set WRAPPER_BASE=%USERPROFILE%\.m2\wrapper\dists
set MAVEN_HOME=%WRAPPER_BASE%\apache-maven-%MAVEN_VERSION%
set MAVEN_CMD=%MAVEN_HOME%\bin\mvn.cmd
set MAVEN_ZIP=%WRAPPER_BASE%\apache-maven-%MAVEN_VERSION%-bin.zip
set MAVEN_URL=https://archive.apache.org/dist/maven/maven-3/%MAVEN_VERSION%/binaries/apache-maven-%MAVEN_VERSION%-bin.zip

if not exist "%MAVEN_CMD%" (
  if not exist "%WRAPPER_BASE%" mkdir "%WRAPPER_BASE%"
  if not exist "%MAVEN_ZIP%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%MAVEN_URL%' -OutFile '%MAVEN_ZIP%'"
    if errorlevel 1 exit /b 1
  )
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%MAVEN_ZIP%' -DestinationPath '%WRAPPER_BASE%' -Force"
  if errorlevel 1 exit /b 1
)

call "%MAVEN_CMD%" %*
endlocal
