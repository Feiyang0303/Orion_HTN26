#!/bin/sh
# Build the Quest APK from the command line. Usage: ./build.sh [setup|apk|test]   (default: apk)
set -eu
cd "$(dirname "$0")"
VERSION=$(sed -n 's/^m_EditorVersion: //p' ProjectSettings/ProjectVersion.txt)
UNITY="${UNITY:-/Applications/Unity/Hub/Editor/$VERSION/Unity.app/Contents/MacOS/Unity}"
[ -x "$UNITY" ] || { echo "Unity $VERSION not found at $UNITY (set UNITY=/path/to/Unity)"; exit 1; }
mkdir -p Logs
case "${1:-apk}" in
  setup) "$UNITY" -batchmode -quit -projectPath . -buildTarget Android -executeMethod Orion.Editor.Build.Setup -logFile Logs/setup.log ;;
  apk)   "$UNITY" -batchmode -quit -projectPath . -buildTarget Android -executeMethod Orion.Editor.Build.Apk -logFile Logs/build.log && ls -lh Build/orion-quest.apk ;;
  test)  "$UNITY" -batchmode -projectPath . -buildTarget Android -runTests -testPlatform EditMode -testResults Logs/tests.xml -logFile Logs/tests.log ;;
  *) echo "usage: $0 [setup|apk|test]"; exit 2 ;;
esac
