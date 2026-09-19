#!/bin/sh
# Build the Quest APK from the command line. Usage: ./build.sh [setup|apk|test|smoke]   (default: apk)
set -eu
cd "$(dirname "$0")"
VERSION=$(sed -n 's/^m_EditorVersion: //p' ProjectSettings/ProjectVersion.txt)
UNITY="${UNITY:-/Applications/Unity/Hub/Editor/$VERSION/Unity.app/Contents/MacOS/Unity}"
[ -x "$UNITY" ] || { echo "Unity $VERSION not found at $UNITY (set UNITY=/path/to/Unity)"; exit 1; }
mkdir -p Logs
unity() { "$UNITY" -batchmode -projectPath . -buildTarget Android "$@"; }
text() { [ -d "Assets/TextMesh Pro" ] || unity -executeMethod Orion.Editor.Build.ImportText -logFile Logs/text.log; }
case "${1:-apk}" in
  setup) text && unity -quit -executeMethod Orion.Editor.Build.Setup -logFile Logs/setup.log ;;
  apk)   text && unity -quit -executeMethod Orion.Editor.Build.Apk -logFile Logs/build.log && ls -lh Build/orion-quest.apk ;;
  test)  text && unity -runTests -testPlatform EditMode -testResults Logs/tests.xml -logFile Logs/tests.log ;;
  smoke) text && "$UNITY" -batchmode -projectPath . -buildTarget Android -executeMethod Orion.Editor.Smoke.Run -logFile Logs/smoke.log; grep "\[smoke" Logs/smoke.log ;;
  *) echo "usage: $0 [setup|apk|test|smoke]"; exit 2 ;;
esac
