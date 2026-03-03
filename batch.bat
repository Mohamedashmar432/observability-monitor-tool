@echo off

set BASE_URL=http://localhost:5000
set JOB_SLUG=watcher-d3eb49-b9cd0a9062c02610
set SECRET=0b81fe27-83f4-4c3b-9992-512a85868b1c

echo Job starting...

curl -X POST %BASE_URL%/api/cron/%JOB_SLUG%/start ^
  -H "X-Heartbeat-Secret: %SECRET%"

REM simulate work
timeout /t 5 /nobreak >nul

echo Job completing...

curl -X POST %BASE_URL%/api/cron/%JOB_SLUG%/success ^
  -H "X-Heartbeat-Secret: %SECRET%"

echo Done.

http://localhost:5000/api/cron/watcher-d3eb49-b9cd0a9062c02610/start