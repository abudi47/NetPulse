#!/usr/bin/env bash
set -u

printf '\n== NetPulse development environment ==\n'
for command_name in node npm java adb; do
  if command -v "$command_name" >/dev/null 2>&1; then
    printf '\n-- %s --\n' "$command_name"
    case "$command_name" in
      node) node --version ;;
      npm) npm --version ;;
      java) java -version 2>&1 | head -n 3 ;;
      adb) adb version | head -n 2 ;;
    esac
  else
    printf '\nMISSING: %s\n' "$command_name"
  fi
done

printf '\nANDROID_HOME=%s\n' "${ANDROID_HOME:-<not set>}"
printf 'ANDROID_SDK_ROOT=%s\n' "${ANDROID_SDK_ROOT:-<not set>}"
printf 'JAVA_HOME=%s\n' "${JAVA_HOME:-<not set>}"

if command -v adb >/dev/null 2>&1; then
  printf '\n-- connected Android devices --\n'
  adb devices
fi

printf '\nNote: compare Node/JDK/SDK versions with https://reactnative.dev/versions for your exact React Native release.\n'
