@echo off

echo [batch2] Job started at %date% %time%

REM Simulate some actual work
timeout /t 3 /nobreak >nul

echo [batch2] Work complete at %date% %time%
