@echo off
rem Tezgah's command line, available in every Tezgah terminal.
if "%TEZGAH_CLI%"=="" (
  echo tezgah: run this inside a Tezgah terminal 1>&2
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=1
"%TEZGAH_ELECTRON%" "%TEZGAH_CLI%" %*
